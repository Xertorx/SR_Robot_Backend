const store = require('../models/store');
const NotificationService = require('./notificationService');
const paymentService = require('./paymentService');
const { ORDER_STATES: S, ALLOWED_TRANSITIONS, SUB_STATES } = require('../constants/orderStates');
const { AppError } = require('../utils/errors');
const { addHours, addDaysToDate } = require('../utils/dates');

const findOrder = (id) => {
  const order = store.orders.find((o) => o.id === Number(id));
  if (!order) throw new AppError('Orden no encontrada', 404);
  return order;
};

const isClientOf = (order, user) => order.clientId === user.id;
const isTechOf = (order, user) => order.technicianUserId === user.id;

const assertAccess = (order, user) => {
  if (user.role === 'ADMIN' || isClientOf(order, user) || isTechOf(order, user)) return;
  throw new AppError('No tienes acceso a esta orden', 403);
};

const addHistory = (order, { state, subState = null, note = '', actorId = null, media = [] }) => {
  order.history.push({ state, subState, note, actorId, media, timestamp: new Date() });
  order.updatedAt = new Date();
};

const counterpartId = (order, actor) => (actor.id === order.clientId ? order.technicianUserId : order.clientId);

const notifyOrder = (userId, order, title, body) =>
  NotificationService.notify({ userId, type: 'ORDER', title, body, metadata: { orderId: order.id, state: order.state } });

const create = ({
  client, tech, serviceName, amount, homeFee = 0, isHomeService = false, paymentMethod, address = null, equipmentId = null,
  warrantyDays = 90, source, appointmentId = null, quoteId = null, requestId = null, estimatedHours = null,
  estimatedDelivery = null, description = ''
}) => {
  if (client.id === tech.userId) throw new AppError('No puedes contratar tu propio negocio', 400);
  paymentService.assertMethod(client, paymentMethod);
  if (equipmentId && !store.equipments.some((e) => e.id === Number(equipmentId) && e.userId === client.id)) {
    throw new AppError('Equipo no encontrado', 404);
  }
  const total = amount + homeFee;
  const order = {
    id: store.nextId('orders'), clientId: client.id, technicianId: tech.id, technicianUserId: tech.userId,
    serviceName, description, baseAmount: amount, homeFee, adjustmentsTotal: 0, amount: total,
    currency: paymentService.countryFor(client).currency, isHomeService, address, paymentMethod,
    equipmentId: equipmentId ? Number(equipmentId) : null,
    source, appointmentId, quoteId, requestId, estimatedHours,
    estimatedDelivery: estimatedDelivery || (estimatedHours ? addHours(new Date(), estimatedHours) : null),
    warrantyDays, warrantyExpiresAt: null, state: S.SOLICITADO, subState: null,
    escrowStatus: 'PENDING', paymentStatus: 'PENDING', platformCommission: 0, adjustments: [], history: [],
    createdAt: new Date(), updatedAt: new Date()
  };
  addHistory(order, { state: S.SOLICITADO, note: 'Orden creada', actorId: client.id });
  store.orders.push(order);

  const payment = paymentService.createPayment({ type: 'ORDER', order, user: client, amount: total, method: paymentMethod });
  notifyOrder(tech.userId, order, '🛠️ Nueva orden', `Tienes una nueva orden: ${serviceName}`);
  return { order, payment };
};

// Si la pasarela rechaza el pago, la orden no puede avanzar: se cancela y libera la franja
const failForPayment = (order, payment) => {
  if (payment.type === 'ORDER_ADJUSTMENT') {
    const adj = order.adjustments.find((a) => a.paymentId === payment.id);
    if (adj) {
      adj.status = 'PAYMENT_FAILED';
      order.amount -= adj.amount;
      order.adjustmentsTotal -= adj.amount;
    }
    notifyOrder(order.clientId, order, '⚠️ Pago rechazado', 'No pudimos cobrar el costo adicional.');
    return;
  }
  order.paymentStatus = 'FAILED';
  order.escrowStatus = 'FAILED';
  order.state = S.CANCELADO;
  addHistory(order, { state: S.CANCELADO, note: 'Orden cancelada: el pago fue rechazado' });
  syncAppointment(order);
  notifyOrder(order.clientId, order, '⚠️ Pago rechazado', 'Tu orden se canceló porque el pago fue rechazado.');
};

const syncAppointment = (order) => {
  const appointment = store.appointments.find((a) => a.id === order.appointmentId);
  if (!appointment) return;
  if (order.state === S.DIAGNOSTICO) appointment.status = 'IN_PROGRESS';
  if (order.state === S.ENTREGADO) appointment.status = 'COMPLETED';
  if (order.state === S.CANCELADO) appointment.status = 'CANCELLED';
};

const cancel = (order, actor, reason = '') => {
  if (![S.SOLICITADO, S.DIAGNOSTICO, S.EN_REPARACION].includes(order.state)) {
    throw new AppError(`No se puede cancelar una orden en estado ${order.state}. Si hay un problema, abre una disputa`, 400);
  }
  const byClient = isClientOf(order, actor);
  const byTech = isTechOf(order, actor);
  if (!byClient && !byTech && actor.role !== 'ADMIN') throw new AppError('No tienes permiso para cancelar esta orden', 403);

  // El cliente recibe el reembolso según la política; si cancela el técnico o el admin, es total
  let rate = 1;
  if (byClient) {
    rate = store.settings.cancellation[order.state];
    if (rate === undefined) throw new AppError('Ya no puedes cancelar en este estado; abre una disputa', 400);
  }
  const refundAmount = Math.round(paymentService.heldAmount(order) * rate);
  const result = paymentService.settle(order, { refundAmount });

  order.state = S.CANCELADO;
  order.subState = null;
  addHistory(order, { state: S.CANCELADO, note: reason || 'Orden cancelada', actorId: actor.id });
  syncAppointment(order);
  notifyOrder(counterpartId(order, actor), order, '❌ Orden cancelada', `La orden #${order.id} fue cancelada.`);
  return result;
};

const confirmDelivery = (order, actor, note) => {
  order.state = S.ENTREGADO;
  order.subState = null;
  order.warrantyExpiresAt = addDaysToDate(new Date(), order.warrantyDays);
  paymentService.settle(order, { refundAmount: 0 });
  addHistory(order, { state: S.ENTREGADO, note: note || 'Cliente confirmó la recepción', actorId: actor.id });
  syncAppointment(order);
  notifyOrder(order.technicianUserId, order, '💰 Pago liberado', `El cliente confirmó la orden #${order.id}.`);
};

const transition = (order, actor, newState, { note, reason, subState } = {}) => {
  const allowed = ALLOWED_TRANSITIONS[order.state] || [];
  if (!allowed.includes(newState)) {
    throw new AppError(`Transición inválida de ${order.state} hacia ${newState}. Permitidas: ${allowed.join(', ') || 'ninguna'}`, 400);
  }
  const admin = actor.role === 'ADMIN';
  const tech = isTechOf(order, actor);

  if (newState === S.CANCELADO) {
    if (order.state === S.DISPUTA) throw new AppError('Una orden en disputa solo la resuelve el administrador', 403);
    cancel(order, actor, reason || note);
    return order;
  }
  if (newState === S.DISPUTA) {
    require('./disputeService').open(order, actor, { reason, description: note });
    return order;
  }
  if (newState === S.ENTREGADO) {
    if (order.state !== S.LISTO) throw new AppError('Solo se puede entregar una orden en estado LISTO', 400);
    if (!isClientOf(order, actor) && !admin) throw new AppError('Solo el cliente confirma la recepción', 403);
    confirmDelivery(order, actor, note);
    return order;
  }

  // DIAGNOSTICO, EN_REPARACION y LISTO los avanza el técnico
  if (!tech && !admin) throw new AppError('Solo el técnico de la orden puede cambiar este estado', 403);
  if (newState === S.EN_REPARACION && order.adjustments.some((a) => a.status === 'PENDING')) {
    throw new AppError('Hay un costo adicional pendiente de aprobación del cliente', 409);
  }
  order.state = newState;
  order.subState = subState && (SUB_STATES[newState] || []).includes(subState) ? subState : null;
  addHistory(order, { state: newState, subState: order.subState, note: note || `Estado actualizado a ${newState}`, actorId: actor.id });
  syncAppointment(order);
  notifyOrder(
    order.clientId, order,
    newState === S.LISTO ? '✅ Tu equipo está listo' : `📦 Actualización de la orden #${order.id}`,
    `Tu orden ahora está en estado: ${newState}`
  );
  return order;
};

const setSubState = (order, actor, subState) => {
  if (!isTechOf(order, actor) && actor.role !== 'ADMIN') throw new AppError('Solo el técnico puede cambiar el subestado', 403);
  const valid = SUB_STATES[order.state] || [];
  if (!valid.includes(subState)) throw new AppError(`Subestado inválido para ${order.state}. Opciones: ${valid.join(', ') || 'ninguno'}`, 400);
  order.subState = subState;
  addHistory(order, { state: order.state, subState, note: `Subestado: ${subState}`, actorId: actor.id });
  return order;
};

const addEvidence = (order, actor, { note, media }) => {
  if (!isTechOf(order, actor)) throw new AppError('Solo el técnico de la orden puede subir evidencias', 403);
  if ([S.ENTREGADO, S.CANCELADO].includes(order.state)) throw new AppError('La orden ya está cerrada', 400);
  if (!note && !media.length) throw new AppError('Envía una nota o al menos una foto', 400);
  addHistory(order, { state: order.state, subState: order.subState, note: note || 'Avance de la reparación', actorId: actor.id, media });
  notifyOrder(order.clientId, order, '📸 Nuevo avance', `El técnico agregó un avance a tu orden #${order.id}`);
};

const requestAdjustment = (order, actor, { amount, reason }) => {
  if (!isTechOf(order, actor)) throw new AppError('Solo el técnico de la orden puede solicitar costos adicionales', 403);
  if (![S.DIAGNOSTICO, S.EN_REPARACION].includes(order.state)) {
    throw new AppError('Los costos adicionales solo se piden en DIAGNOSTICO o EN_REPARACION', 400);
  }
  if (order.adjustments.some((a) => a.status === 'PENDING')) throw new AppError('Ya hay un costo adicional pendiente', 409);
  const adjustment = { id: store.nextId('adjustments'), amount, reason, status: 'PENDING', paymentId: null, createdAt: new Date() };
  order.adjustments.push(adjustment);
  addHistory(order, { state: order.state, note: `Costo adicional solicitado: ${amount} (${reason})`, actorId: actor.id });
  NotificationService.notify({
    userId: order.clientId, type: 'ADJUSTMENT', title: '💲 Costo adicional por aprobar',
    body: `${amount} ${order.currency}: ${reason}`, metadata: { orderId: order.id, adjustmentId: adjustment.id }
  });
  return adjustment;
};

const resolveAdjustment = (order, actor, adjustmentId, approve) => {
  if (!isClientOf(order, actor)) throw new AppError('Solo el cliente aprueba o rechaza costos adicionales', 403);
  const adjustment = order.adjustments.find((a) => a.id === Number(adjustmentId));
  if (!adjustment) throw new AppError('Ajuste no encontrado', 404);
  if (adjustment.status !== 'PENDING') throw new AppError(`El ajuste ya fue ${adjustment.status}`, 409);

  if (approve) {
    adjustment.status = 'APPROVED';
    order.amount += adjustment.amount;
    order.adjustmentsTotal += adjustment.amount;
    const payment = paymentService.createPayment({
      type: 'ORDER_ADJUSTMENT', order, user: actor, amount: adjustment.amount, method: order.paymentMethod
    });
    adjustment.paymentId = payment.id;
  } else {
    adjustment.status = 'REJECTED';
  }
  adjustment.resolvedAt = new Date();
  addHistory(order, { state: order.state, note: `Costo adicional ${approve ? 'aprobado' : 'rechazado'}`, actorId: actor.id });
  notifyOrder(order.technicianUserId, order, approve ? '👍 Costo adicional aprobado' : '👎 Costo adicional rechazado', `Orden #${order.id}`);
  return adjustment;
};

const serialize = (order) => {
  const client = store.users.find((u) => u.id === order.clientId);
  const tech = store.technicians.find((t) => t.id === order.technicianId);
  return {
    ...order,
    clientName: client ? client.name : null,
    technicianName: tech ? tech.businessName : null,
    timeline: order.history,
    pendingAdjustment: order.adjustments.find((a) => a.status === 'PENDING') || null,
    paymentBreakdown: {
      service: order.baseAmount, homeFee: order.homeFee, adjustments: order.adjustmentsTotal,
      platformFee: 0, total: order.amount, currency: order.currency
    },
    warranty: {
      days: order.warrantyDays, expiresAt: order.warrantyExpiresAt,
      active: Boolean(order.warrantyExpiresAt && order.warrantyExpiresAt > new Date())
    },
    reviewed: store.reviews.some((r) => r.orderId === order.id)
  };
};

module.exports = {
  findOrder, assertAccess, addHistory, create, failForPayment, cancel, transition, setSubState, addEvidence,
  requestAdjustment, resolveAdjustment, serialize, isClientOf, isTechOf
};
