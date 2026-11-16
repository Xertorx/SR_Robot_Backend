const store = require('../models/store');
const technicianService = require('../services/technicianService');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, toInt, toNumberOrNull, parseBool } = require('../utils/validate');

const own = (collection, user) => store[collection].filter((x) => x.userId === user.id);

const findOwn = (collection, id, user, label) => {
  const item = store[collection].find((x) => x.id === Number(id) && x.userId === user.id);
  if (!item) throw new AppError(`${label} no encontrado`, 404);
  return item;
};

// Mantiene una sola predeterminada por usuario
const setDefault = (collection, user, item) => {
  own(collection, user).forEach((x) => { x.isDefault = x.id === item.id; });
};

// ---- Direcciones (HC-19) ----
const listAddresses = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: own('addresses', req.user) });
});

const createAddress = asyncHandler(async (req, res) => {
  requireFields(req.body, ['address']);
  const address = {
    id: store.nextId('addresses'), userId: req.user.id, label: req.body.label || 'Casa', address: String(req.body.address),
    city: req.body.city || 'Bogotá', lat: toNumberOrNull(req.body.lat), lng: toNumberOrNull(req.body.lng), notes: req.body.notes || '',
    isDefault: false
  };
  store.addresses.push(address);
  if (parseBool(req.body.isDefault) || own('addresses', req.user).length === 1) setDefault('addresses', req.user, address);
  res.status(201).json({ success: true, data: address });
});

const updateAddress = asyncHandler(async (req, res) => {
  const address = findOwn('addresses', req.params.id, req.user, 'Dirección');
  ['label', 'address', 'city', 'notes'].forEach((k) => { if (req.body[k] !== undefined) address[k] = String(req.body[k]); });
  if (req.body.lat !== undefined) address.lat = toNumberOrNull(req.body.lat);
  if (req.body.lng !== undefined) address.lng = toNumberOrNull(req.body.lng);
  if (parseBool(req.body.isDefault)) setDefault('addresses', req.user, address);
  res.status(200).json({ success: true, data: address });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const address = findOwn('addresses', req.params.id, req.user, 'Dirección');
  store.addresses.splice(store.addresses.indexOf(address), 1);
  const rest = own('addresses', req.user);
  if (address.isDefault && rest.length) setDefault('addresses', req.user, rest[0]);
  res.status(200).json({ success: true, message: 'Dirección eliminada' });
});

// ---- Equipos y garantías (HC-18) ----
const withWarranty = (equipment) => {
  const orders = store.orders
    .filter((o) => o.equipmentId === equipment.id && o.state === 'ENTREGADO')
    .sort((a, b) => b.warrantyExpiresAt - a.warrantyExpiresAt);
  const last = orders[0] || null;
  return {
    ...equipment,
    warranty: last
      ? { status: last.warrantyExpiresAt > new Date() ? 'ACTIVE' : 'EXPIRED', expiresAt: last.warrantyExpiresAt, orderId: last.id }
      : { status: 'NONE', expiresAt: null, orderId: null },
    lastService: last ? { orderId: last.id, serviceName: last.serviceName, date: last.warrantyExpiresAt } : null
  };
};

const listEquipments = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: own('equipments', req.user).map(withWarranty) });
});

const createEquipment = asyncHandler(async (req, res) => {
  requireFields(req.body, ['type', 'brand', 'model']);
  const equipment = {
    id: store.nextId('equipments'), userId: req.user.id, type: req.body.type, brand: req.body.brand, model: req.body.model,
    nickname: req.body.nickname || '', purchaseDate: req.body.purchaseDate || null, createdAt: new Date()
  };
  store.equipments.push(equipment);
  res.status(201).json({ success: true, data: withWarranty(equipment) });
});

const updateEquipment = asyncHandler(async (req, res) => {
  const equipment = findOwn('equipments', req.params.id, req.user, 'Equipo');
  ['type', 'brand', 'model', 'nickname', 'purchaseDate'].forEach((k) => { if (req.body[k] !== undefined) equipment[k] = req.body[k]; });
  res.status(200).json({ success: true, data: withWarranty(equipment) });
});

const deleteEquipment = asyncHandler(async (req, res) => {
  const equipment = findOwn('equipments', req.params.id, req.user, 'Equipo');
  store.equipments.splice(store.equipments.indexOf(equipment), 1);
  res.status(200).json({ success: true, message: 'Equipo eliminado' });
});

const listWarranties = asyncHandler(async (req, res) => {
  const warranties = store.orders
    .filter((o) => o.clientId === req.user.id && o.state === 'ENTREGADO' && o.warrantyExpiresAt)
    .map((o) => ({
      orderId: o.id, serviceName: o.serviceName, technicianId: o.technicianId, equipmentId: o.equipmentId,
      days: o.warrantyDays, expiresAt: o.warrantyExpiresAt, active: o.warrantyExpiresAt > new Date()
    }));
  res.status(200).json({ success: true, data: warranties });
});

// ---- Métodos de pago tokenizados (HC-19): jamás se recibe ni guarda el número de tarjeta ----
const listPaymentMethods = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: own('paymentMethods', req.user).map(({ gatewayToken, ...m }) => m) });
});

const createPaymentMethod = asyncHandler(async (req, res) => {
  if (['cardNumber', 'number', 'cvv', 'cvc'].some((k) => req.body[k] !== undefined)) {
    throw new AppError('No envíes datos sensibles de la tarjeta; usa el token de la pasarela (gatewayToken)', 400);
  }
  requireFields(req.body, ['gatewayToken', 'type']);
  if (!['CARD', 'NEQUI', 'DAVIPLATA'].includes(req.body.type)) throw new AppError('type inválido. Opciones: CARD, NEQUI, DAVIPLATA', 400);
  const last4 = req.body.last4 ? String(req.body.last4) : null;
  if (last4 && !/^\d{4}$/.test(last4)) throw new AppError('last4 debe tener 4 dígitos', 400);

  const method = {
    id: store.nextId('paymentMethods'), userId: req.user.id, type: req.body.type, brand: req.body.brand || null, last4,
    holderName: req.body.holderName || null, gatewayToken: String(req.body.gatewayToken), isDefault: false, createdAt: new Date()
  };
  store.paymentMethods.push(method);
  if (parseBool(req.body.isDefault) || own('paymentMethods', req.user).length === 1) setDefault('paymentMethods', req.user, method);
  const { gatewayToken, ...safe } = method;
  res.status(201).json({ success: true, data: safe });
});

const updatePaymentMethod = asyncHandler(async (req, res) => {
  const method = findOwn('paymentMethods', req.params.id, req.user, 'Método de pago');
  if (parseBool(req.body.isDefault)) setDefault('paymentMethods', req.user, method);
  const { gatewayToken, ...safe } = method;
  res.status(200).json({ success: true, data: safe });
});

const deletePaymentMethod = asyncHandler(async (req, res) => {
  const method = findOwn('paymentMethods', req.params.id, req.user, 'Método de pago');
  store.paymentMethods.splice(store.paymentMethods.indexOf(method), 1);
  res.status(200).json({ success: true, message: 'Método de pago eliminado' });
});

// ---- Favoritos (HC-20) ----
const listFavorites = asyncHandler(async (req, res) => {
  const data = store.favorites
    .filter((f) => f.userId === req.user.id)
    .map((f) => technicianService.getById(f.technicianId))
    .filter((t) => t && technicianService.isListed(t))
    .map((t) => technicianService.publicView(t));
  res.status(200).json({ success: true, data });
});

const addFavorite = asyncHandler(async (req, res) => {
  const technicianId = toInt(req.params.technicianId, 'technicianId');
  const tech = technicianService.getById(technicianId);
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
  if (!store.favorites.some((f) => f.userId === req.user.id && f.technicianId === technicianId)) {
    store.favorites.push({ id: store.nextId('favorites'), userId: req.user.id, technicianId, createdAt: new Date() });
  }
  res.status(201).json({ success: true, message: 'Agregado a favoritos' });
});

const removeFavorite = asyncHandler(async (req, res) => {
  const technicianId = toInt(req.params.technicianId, 'technicianId');
  store.favorites = store.favorites.filter((f) => !(f.userId === req.user.id && f.technicianId === technicianId));
  res.status(200).json({ success: true, message: 'Eliminado de favoritos' });
});

module.exports = {
  listAddresses, createAddress, updateAddress, deleteAddress, listEquipments, createEquipment, updateEquipment, deleteEquipment,
  listWarranties, listPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod, listFavorites,
  addFavorite, removeFavorite
};
