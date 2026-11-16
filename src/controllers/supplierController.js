const store = require('../models/store');
const NotificationService = require('../services/notificationService');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, toPositiveInt, parseBool, stripAccents, paginate } = require('../utils/validate');

const findProduct = (id) => {
  const product = store.spareParts.find((p) => p.id === Number(id));
  if (!product) throw new AppError('Producto no encontrado', 404);
  return product;
};

const assertOwner = (product, user) => {
  if (product.supplierId !== user.id) throw new AppError('Este producto no pertenece a tu catálogo', 403);
};

const technicianDiscount = (user) => {
  if (user.role !== 'TECHNICIAN') return 0;
  const tech = store.technicians.find((t) => t.userId === user.id);
  return tech ? store.settings.plans[tech.plan].discountSpareParts || 0 : 0;
};

const priced = (product, discount) => ({
  ...product, listPrice: product.price, discount, price: Math.round(product.price * (1 - discount))
});

// HT-13: catálogo por categoría con precio según el plan del técnico
const getSpareParts = asyncHandler(async (req, res) => {
  const { category, q, supplierId } = req.query;
  const discount = technicianDiscount(req.user);
  let list = store.spareParts.filter((p) => p.active);
  if (req.user.role === 'SUPPLIER' && parseBool(req.query.mine)) list = store.spareParts.filter((p) => p.supplierId === req.user.id);
  if (category) list = list.filter((p) => stripAccents(p.category) === stripAccents(category));
  if (supplierId) list = list.filter((p) => p.supplierId === Number(supplierId));
  if (q) list = list.filter((p) => stripAccents(p.name).includes(stripAccents(q)));
  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, count: meta.total, meta, data: items.map((p) => priced(p, discount)) });
});

const parseProduct = (body, partial = false) => {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw new AppError('Campo requerido: name', 400);
    out.name = String(body.name).trim();
  }
  if (!partial || body.category !== undefined) {
    if (!body.category) throw new AppError('Campo requerido: category', 400);
    out.category = String(body.category);
  }
  if (!partial || body.price !== undefined) out.price = toPositiveInt(body.price, 'price');
  if (!partial || body.stock !== undefined) {
    const stock = Number(body.stock);
    if (!Number.isInteger(stock) || stock < 0) throw new AppError('stock debe ser un entero mayor o igual a 0', 400);
    out.stock = stock;
  }
  if (body.description !== undefined) out.description = String(body.description);
  return out;
};

const createProduct = asyncHandler(async (req, res) => {
  const product = { id: store.nextId('spareParts'), supplierId: req.user.id, description: '', active: true, createdAt: new Date(), ...parseProduct(req.body) };
  store.spareParts.push(product);
  res.status(201).json({ success: true, data: product });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = findProduct(req.params.id);
  assertOwner(product, req.user);
  Object.assign(product, parseProduct(req.body, true));
  if (req.body.active !== undefined) product.active = parseBool(req.body.active);
  res.status(200).json({ success: true, data: product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const product = findProduct(req.params.id);
  assertOwner(product, req.user);
  product.active = false;
  res.status(200).json({ success: true, message: 'Producto retirado del catálogo' });
});

// Precios y stock se calculan en el servidor; un pedido por proveedor
const createOrder = asyncHandler(async (req, res) => {
  const { items, shippingAddress } = req.body;
  requireFields(req.body, ['items', 'shippingAddress']);
  if (!Array.isArray(items) || !items.length) throw new AppError('items debe ser una lista con al menos un producto', 400);

  const discount = technicianDiscount(req.user);
  const { freeFrom, fee } = store.settings.shipping;
  const lines = items.map((item) => {
    const product = findProduct(item.productId);
    const quantity = toPositiveInt(item.quantity, 'quantity');
    if (!product.active) throw new AppError(`"${product.name}" ya no está disponible`, 409);
    if (product.stock < quantity) throw new AppError(`Stock insuficiente para "${product.name}" (disponible: ${product.stock})`, 409);
    return { product, quantity };
  });
  const merged = new Map();
  lines.forEach((l) => merged.set(l.product.id, { product: l.product, quantity: (merged.get(l.product.id) || { quantity: 0 }).quantity + l.quantity }));
  merged.forEach(({ product, quantity }) => {
    if (product.stock < quantity) throw new AppError(`Stock insuficiente para "${product.name}" (disponible: ${product.stock})`, 409);
  });

  const bySupplier = new Map();
  merged.forEach((line) => {
    const list = bySupplier.get(line.product.supplierId) || [];
    list.push(line);
    bySupplier.set(line.product.supplierId, list);
  });

  const orders = [];
  bySupplier.forEach((supplierLines, supplierId) => {
    const orderItems = supplierLines.map(({ product, quantity }) => {
      const unitPrice = Math.round(product.price * (1 - discount));
      return { productId: product.id, name: product.name, quantity, listPrice: product.price, unitPrice, subtotal: unitPrice * quantity };
    });
    const subtotal = orderItems.reduce((s, i) => s + i.subtotal, 0);
    const shipping = subtotal >= freeFrom ? 0 : fee;
    const order = {
      id: store.nextId('supplierOrders'), buyerId: req.user.id, supplierId, items: orderItems, subtotal, discountRate: discount,
      shipping, total: subtotal + shipping, b2bCommission: Math.round(subtotal * store.settings.commissions.b2bRate),
      shippingAddress, status: 'PROCESSING', trackingCode: null, createdAt: new Date()
    };
    supplierLines.forEach(({ product, quantity }) => { product.stock -= quantity; });
    store.supplierOrders.push(order);
    orders.push(order);
    NotificationService.notify({ userId: supplierId, type: 'SUPPLIER_ORDER', title: '📦 Nuevo pedido', body: `Pedido #${order.id} por ${order.total}`, metadata: { supplierOrderId: order.id } });
  });

  res.status(201).json({
    success: true, message: 'Pedido de repuestos creado exitosamente',
    data: orders.length === 1 ? orders[0] : orders, orders,
    totals: { subtotal: orders.reduce((s, o) => s + o.subtotal, 0), shipping: orders.reduce((s, o) => s + o.shipping, 0), total: orders.reduce((s, o) => s + o.total, 0) }
  });
});

const listOrders = asyncHandler(async (req, res) => {
  const list = store.supplierOrders
    .filter((o) => (req.user.role === 'SUPPLIER' ? o.supplierId === req.user.id : req.user.role === 'ADMIN' || o.buyerId === req.user.id))
    .filter((o) => !req.query.status || o.status === String(req.query.status).toUpperCase())
    .sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const STATUS_FLOW = { PROCESSING: ['SHIPPED', 'CANCELLED'], SHIPPED: ['DELIVERED'], DELIVERED: [], CANCELLED: [] };

// El proveedor marca envíos; cancelar devuelve el stock
const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = store.supplierOrders.find((o) => o.id === Number(req.params.id));
  if (!order) throw new AppError('Pedido no encontrado', 404);
  if (order.supplierId !== req.user.id) throw new AppError('Este pedido no es de tu catálogo', 403);
  const status = String(req.body.status || '').toUpperCase();
  if (!(STATUS_FLOW[order.status] || []).includes(status)) {
    throw new AppError(`Transición inválida de ${order.status} a ${status || '(vacío)'}. Permitidas: ${STATUS_FLOW[order.status].join(', ') || 'ninguna'}`, 400);
  }
  if (status === 'CANCELLED') {
    order.items.forEach((i) => { const p = store.spareParts.find((x) => x.id === i.productId); if (p) p.stock += i.quantity; });
  }
  if (status === 'SHIPPED') order.trackingCode = req.body.trackingCode || null;
  order.status = status;
  order.updatedAt = new Date();
  NotificationService.notify({ userId: order.buyerId, type: 'SUPPLIER_ORDER', title: '🚚 Actualización de tu pedido', body: `Pedido #${order.id}: ${status}`, metadata: { supplierOrderId: order.id } });
  res.status(200).json({ success: true, data: order });
});

module.exports = { getSpareParts, createProduct, updateProduct, deleteProduct, createOrder, listOrders, updateOrderStatus };
