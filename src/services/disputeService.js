const store = require('../models/store');
const NotificationService = require('./notificationService');
const paymentService = require('./paymentService');
const orderService = require('./orderService');
const auditService = require('./auditService');
const { AppError } = require('../utils/errors');
const { addDaysToDate } = require('../utils/dates');

const OPENABLE = ['SOLICITADO', 'DIAGNOSTICO', 'EN_REPARACION', 'LISTO'];

const open = (order, actor, { reason, description = '', media = [] }) => {
  if (!orderService.isClientOf(order, actor) && !orderService.isTechOf(order, actor)) {
    throw new AppError('Solo el cliente o el técnico de la orden pueden abrir una disputa', 403);
  }
  if (!reason) throw new AppError('Campo requerido: reason', 400);
  if (!OPENABLE.includes(order.state)) throw new AppError(`No se puede abrir una disputa en estado ${order.state}`, 400);

  const dispute = {
    id: store.nextId('disputes'), orderId: order.id, openedBy: actor.id,
    openedByRole: orderService.isClientOf(order, actor) ? 'CLIENT' : 'TECHNICIAN',
    reason, description, media, status: 'OPEN', updates: [], resolution: null, createdAt: new Date()
  };
  store.disputes.push(dispute);

  order.stateBeforeDispute = order.state;
  order.state = 'DISPUTA';
  order.subState = null;
  orderService.addHistory(order, { state: 'DISPUTA', note: `Disputa abierta: ${reason}`, actorId: actor.id, media });

  const otherId = actor.id === order.clientId ? order.technicianUserId : order.clientId;
  NotificationService.notify({ userId: otherId, type: 'DISPUTE', title: '⚖️ Disputa abierta', body: `Se abrió una disputa en la orden #${order.id}`, metadata: { disputeId: dispute.id } });
  NotificationService.notifyAdmins({ type: 'DISPUTE', title: '⚖️ Nueva disputa', body: `Orden #${order.id}: ${reason}`, metadata: { disputeId: dispute.id } });
  return dispute;
};

const addUpdate = (dispute, actor, { note, media = [] }) => {
  if (!note && !media.length) throw new AppError('Envía una nota o evidencias', 400);
  dispute.updates.push({ id: store.nextId('disputeUpdates'), authorId: actor.id, authorRole: actor.role, note, media, createdAt: new Date() });
  return dispute;
};

const canView = (dispute, user) => {
  if (user.role === 'ADMIN') return true;
  const order = store.orders.find((o) => o.id === dispute.orderId);
  return Boolean(order) && (order.clientId === user.id || order.technicianUserId === user.id);
};

// decision: REFUND_FULL | REFUND_PARTIAL | RELEASE (alias REFUND_CLIENT | RELEASE_TECHNICIAN)
const resolve = (dispute, admin, { decision, amount, note = '' }) => {
  if (dispute.status !== 'OPEN') throw new AppError('La disputa ya fue resuelta', 409);
  const normalized = { REFUND_CLIENT: 'REFUND_FULL', RELEASE_TECHNICIAN: 'RELEASE' }[decision] || decision;
  const order = store.orders.find((o) => o.id === dispute.orderId);
  const held = paymentService.heldAmount(order);

  let result;
  if (normalized === 'REFUND_FULL') {
    result = paymentService.settle(order, { refundAmount: held });
    order.state = 'CANCELADO';
  } else if (normalized === 'REFUND_PARTIAL') {
    const refund = Number(amount);
    if (!Number.isInteger(refund) || refund <= 0 || refund >= held) {
      throw new AppError(`Para reembolso parcial indica un monto entero entre 1 y ${held - 1}`, 400);
    }
    result = paymentService.settle(order, { refundAmount: refund });
    order.state = 'ENTREGADO';
  } else if (normalized === 'RELEASE') {
    result = paymentService.settle(order, { refundAmount: 0 });
    order.state = 'ENTREGADO';
  } else {
    throw new AppError('decision inválida. Opciones: REFUND_FULL, REFUND_PARTIAL, RELEASE', 400);
  }

  if (order.state === 'ENTREGADO') order.warrantyExpiresAt = addDaysToDate(new Date(), order.warrantyDays);
  order.subState = null;
  orderService.addHistory(order, { state: order.state, note: `Disputa resuelta: ${normalized}. ${note}`.trim(), actorId: admin.id });
  const appointment = store.appointments.find((a) => a.id === order.appointmentId);
  if (appointment) appointment.status = order.state === 'ENTREGADO' ? 'COMPLETED' : 'CANCELLED';

  dispute.status = 'RESOLVED';
  dispute.resolution = { decision: normalized, amount: result.refunded, note, adminId: admin.id, resolvedAt: new Date() };
  auditService.log({ actorId: admin.id, action: 'DISPUTE_RESOLVED', targetType: 'DISPUTE', targetId: dispute.id, details: { orderId: order.id, decision: normalized, ...result } });

  [order.clientId, order.technicianUserId].forEach((userId) =>
    NotificationService.notify({ userId, type: 'DISPUTE', title: '⚖️ Disputa resuelta', body: `Orden #${order.id}: ${normalized}`, metadata: { disputeId: dispute.id } })
  );
  return { dispute, order, result };
};

module.exports = { open, addUpdate, canView, resolve };
