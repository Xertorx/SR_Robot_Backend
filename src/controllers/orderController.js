const store = require('../models/store');
const orderService = require('../services/orderService');
const disputeService = require('../services/disputeService');
const technicianService = require('../services/technicianService');
const { ACTIVE_STATES } = require('../constants/orderStates');
const { toMedia } = require('../middlewares/upload');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, toInt, toPositiveInt, paginate } = require('../utils/validate');

// Orden creada directamente (sin cita): el precio sale del catálogo del técnico, nunca del cliente
const createOrder = asyncHandler(async (req, res) => {
  requireFields(req.body, ['technicianId', 'serviceId', 'paymentMethod']);
  const tech = technicianService.getById(toInt(req.body.technicianId, 'technicianId'));
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
  if (!tech.isVerified) throw new AppError('Este negocio aún no está verificado', 409);
  const service = tech.services.find((s) => s.id === Number(req.body.serviceId) && s.active);
  if (!service) throw new AppError('Servicio no disponible', 404);

  const isHomeService = req.body.isHomeService === true || req.body.isHomeService === 'true';
  if (isHomeService && !tech.homeService) throw new AppError('Este técnico no atiende a domicilio', 400);
  if (isHomeService && !req.body.address) throw new AppError('Indica la dirección para el servicio a domicilio', 400);

  const client = store.users.find((u) => u.id === req.user.id);
  const { order, payment } = orderService.create({
    client, tech, serviceName: service.name, amount: service.priceFrom, homeFee: isHomeService ? tech.homeExtraFee : 0,
    isHomeService, paymentMethod: req.body.paymentMethod, address: req.body.address || null,
    equipmentId: req.body.equipmentId || null, warrantyDays: service.warrantyDays, source: 'DIRECT',
    estimatedHours: service.estimatedHours
  });
  res.status(201).json({ success: true, message: 'Orden creada. El pago quedó retenido en custodia', data: { order: orderService.serialize(order), payment } });
});

// HC-11: cada usuario ve solo sus órdenes (en curso e historial)
const getOrders = asyncHandler(async (req, res) => {
  const { status, state } = req.query;
  const tech = req.user.role === 'TECHNICIAN' ? technicianService.getByUserId(req.user.id) : null;

  let list = store.orders.filter((o) => {
    if (req.user.role === 'ADMIN') return true;
    if (req.user.role === 'TECHNICIAN') return tech && o.technicianId === tech.id;
    if (req.user.role === 'CLIENT') return o.clientId === req.user.id;
    return false;
  });
  if (status === 'active') list = list.filter((o) => ACTIVE_STATES.includes(o.state));
  if (status === 'history') list = list.filter((o) => !ACTIVE_STATES.includes(o.state));
  if (state) list = list.filter((o) => o.state === String(state).toUpperCase());
  list.sort((a, b) => b.id - a.id);

  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, count: meta.total, meta, data: items.map(orderService.serialize) });
});

const getOrderById = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  res.status(200).json({ success: true, data: orderService.serialize(order) });
});

// HT-07 / HT-08 / HC-13: toda transición pasa por la máquina de estados con validación de rol
const transitionOrderState = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  const newState = req.body.newState || req.body.state || req.body.to;
  const { subState, note, reason } = req.body;

  if (!newState && subState) {
    orderService.setSubState(order, req.user, subState);
  } else {
    if (!newState) throw new AppError('Campo requerido: newState', 400);
    orderService.transition(order, req.user, String(newState).toUpperCase(), { note, reason, subState });
  }
  res.status(200).json({ success: true, message: `Estado actualizado a ${order.state}`, data: orderService.serialize(order) });
});

const confirmReceiptAndReleasePayment = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  orderService.transition(order, req.user, 'ENTREGADO', { note: req.body.note });
  res.status(200).json({
    success: true,
    message: `Recepción confirmada. Pago liberado al técnico y garantía de ${order.warrantyDays} días activada.`,
    data: orderService.serialize(order)
  });
});

const cancelOrder = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  const refund = orderService.cancel(order, req.user, req.body.reason);
  res.status(200).json({ success: true, message: 'Orden cancelada', data: { order: orderService.serialize(order), refund } });
});

const addEvidence = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  orderService.addEvidence(order, req.user, { note: req.body.note, media: toMedia(req.files || []) });
  res.status(201).json({ success: true, data: orderService.serialize(order) });
});

// HC-12: costos adicionales con aprobación del cliente
const requestAdjustment = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  requireFields(req.body, ['amount', 'reason']);
  const adjustment = orderService.requestAdjustment(order, req.user, { amount: toPositiveInt(req.body.amount), reason: String(req.body.reason) });
  res.status(201).json({ success: true, data: adjustment });
});

const resolveAdjustment = (approve) =>
  asyncHandler(async (req, res) => {
    const order = orderService.findOrder(req.params.id);
    orderService.assertAccess(order, req.user);
    const adjustment = orderService.resolveAdjustment(order, req.user, req.params.adjustmentId, approve);
    res.status(200).json({ success: true, data: { adjustment, order: orderService.serialize(order) } });
  });

// HC-21: abrir disputa (con evidencias)
const openDispute = asyncHandler(async (req, res) => {
  const order = orderService.findOrder(req.params.id);
  orderService.assertAccess(order, req.user);
  const dispute = disputeService.open(order, req.user, {
    reason: req.body.reason, description: req.body.description, media: toMedia(req.files || [])
  });
  res.status(201).json({ success: true, data: dispute });
});

module.exports = {
  createOrder, getOrders, getOrderById, transitionOrderState, confirmReceiptAndReleasePayment, cancelOrder, addEvidence,
  requestAdjustment, approveAdjustment: resolveAdjustment(true), rejectAdjustment: resolveAdjustment(false), openDispute
};
