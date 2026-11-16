const store = require('../models/store');
const config = require('../config/env');
const logger = require('../utils/logger');
const { AppError } = require('../utils/errors');

const countryFor = (user) => store.countries[(user && user.country) || config.countryCode] || store.countries[config.countryCode];

const allowedMethods = (user) => countryFor(user).paymentMethods;

const assertMethod = (user, method) => {
  const methods = allowedMethods(user);
  if (!methods.includes(method)) {
    throw new AppError(`Método de pago no disponible en tu país. Opciones: ${methods.join(', ')}`, 400);
  }
};

const getTech = (id) => store.technicians.find((t) => t.id === id);

const addLedger = (technicianId, type, amount, orderId = null, note = '') => {
  const entry = { id: store.nextId('ledger'), technicianId, orderId, type, amount, note, createdAt: new Date() };
  store.ledger.push(entry);
  return entry;
};

// type: ORDER | ORDER_ADJUSTMENT | SUBSCRIPTION
const createPayment = ({ type, order = null, subscription = null, user, amount, method, renewal = false }) => {
  const id = store.nextId('payments');
  const payment = {
    id, reference: `PAY-${Date.now()}-${id}`, type, userId: user.id,
    orderId: order ? order.id : null, subscriptionId: subscription ? subscription.id : null,
    technicianId: order ? order.technicianId : subscription ? subscription.technicianId : null,
    amount, currency: order ? order.currency : subscription.currency, method, renewal,
    status: 'PENDING', escrowStatus: null, refundedAmount: 0, releasedAmount: 0, createdAt: new Date(), updatedAt: new Date()
  };
  store.payments.push(payment);

  // El efectivo se cobra al entregar: no hay custodia
  if (method === 'CASH' && order) {
    payment.status = 'CASH_ON_DELIVERY';
    order.paymentStatus = 'PAY_ON_DELIVERY';
    order.escrowStatus = 'CASH_ON_DELIVERY';
    return payment;
  }

  if (config.payments.autoApprove) handleWebhook({ reference: payment.reference, status: 'APPROVED' });
  return payment;
};

const onApproved = (payment) => {
  const orderService = require('./orderService');
  const subscriptionService = require('./subscriptionService');

  if (payment.type === 'SUBSCRIPTION') return subscriptionService.onPaymentApproved(payment);

  const order = store.orders.find((o) => o.id === payment.orderId);
  const tech = getTech(payment.technicianId);
  if (!order || !tech) return null;

  payment.escrowStatus = 'HELD';
  tech.wallet.held += payment.amount;
  addLedger(tech.id, 'HOLD', payment.amount, order.id, 'Pago retenido en custodia');
  order.escrowStatus = 'HELD';
  order.paymentStatus = 'PAID';
  orderService.addHistory(order, { state: order.state, note: 'Pago confirmado y retenido en custodia' });

  // Si la orden ya se canceló mientras llegaba el pago, se devuelve de inmediato
  if (order.state === 'CANCELADO') settle(order, { refundAmount: payment.amount });
  return null;
};

const onDeclined = (payment) => {
  const orderService = require('./orderService');
  const subscriptionService = require('./subscriptionService');

  if (payment.type === 'SUBSCRIPTION') return subscriptionService.onPaymentDeclined(payment);
  const order = store.orders.find((o) => o.id === payment.orderId);
  if (order) orderService.failForPayment(order, payment);
  return null;
};

// Manejador único para webhooks de la pasarela (idempotente por referencia)
const handleWebhook = ({ reference, status }) => {
  if (!reference || !['APPROVED', 'DECLINED'].includes(status)) {
    throw new AppError('Webhook inválido: se requiere reference y status (APPROVED | DECLINED)', 400);
  }
  const payment = store.payments.find((p) => p.reference === reference);
  if (!payment) throw new AppError('Pago no encontrado', 404);
  if (payment.status === status) return { payment, duplicate: true };
  if (payment.status !== 'PENDING') throw new AppError(`El pago ya está en estado ${payment.status}`, 409);

  payment.status = status;
  payment.updatedAt = new Date();
  logger.info(`💳 [WEBHOOK] ${reference} -> ${status}`);
  if (status === 'APPROVED') onApproved(payment);
  else onDeclined(payment);
  return { payment, duplicate: false };
};

const heldPayments = (order) => store.payments.filter((p) => p.orderId === order.id && p.escrowStatus === 'HELD');

const heldAmount = (order) => heldPayments(order).reduce((s, p) => s + p.amount, 0);

// Cierra la custodia: devuelve refundAmount al cliente y libera el resto al técnico (menos comisión si está activa)
const settle = (order, { refundAmount = 0 } = {}) => {
  const tech = getTech(order.technicianId);
  const held = heldPayments(order);
  const total = held.reduce((s, p) => s + p.amount, 0);
  const refund = Math.min(Math.max(Math.round(refundAmount), 0), total);
  let remainingRefund = refund;

  held.forEach((p) => {
    const pRefund = Math.min(p.amount, remainingRefund);
    remainingRefund -= pRefund;
    p.refundedAmount = pRefund;
    p.releasedAmount = p.amount - pRefund;
    p.escrowStatus = p.releasedAmount === 0 ? 'REFUNDED' : pRefund > 0 ? 'PARTIALLY_REFUNDED' : 'RELEASED';
    p.updatedAt = new Date();
  });

  const toRelease = total - refund;
  const { transactionEnabled, transactionRate } = store.settings.commissions;
  const commission = transactionEnabled ? Math.round(toRelease * transactionRate) : 0;
  const net = toRelease - commission;

  if (tech && total > 0) {
    tech.wallet.held -= total;
    tech.wallet.available += net;
    if (refund > 0) addLedger(tech.id, 'REFUND', refund, order.id, 'Reembolso al cliente');
    if (net > 0) addLedger(tech.id, 'RELEASE', net, order.id, 'Pago liberado');
    if (commission > 0) addLedger(tech.id, 'COMMISSION', commission, order.id, 'Comisión de la plataforma');
  }

  if (total > 0) {
    order.escrowStatus = refund === total ? 'REFUNDED' : refund > 0 ? 'PARTIALLY_REFUNDED' : 'RELEASED';
    order.paymentStatus = refund === total ? 'REFUNDED' : 'SETTLED';
  } else if (order.escrowStatus === 'CASH_ON_DELIVERY') {
    order.escrowStatus = order.state === 'ENTREGADO' ? 'CASH_COLLECTED' : 'NOT_CHARGED';
  }
  order.platformCommission = commission;
  return { refunded: refund, released: toRelease, commission, net };
};

const withdraw = (tech, { amount, destination }) => {
  if (amount > tech.wallet.available) throw new AppError('Saldo disponible insuficiente', 400);
  tech.wallet.available -= amount;
  tech.wallet.withdrawn += amount;
  const withdrawal = {
    id: store.nextId('withdrawals'), technicianId: tech.id, amount, destination, status: 'PROCESSING', createdAt: new Date()
  };
  store.withdrawals.push(withdrawal);
  addLedger(tech.id, 'WITHDRAWAL', amount, null, `Retiro a ${destination.type}`);
  return withdrawal;
};

module.exports = {
  allowedMethods, assertMethod, countryFor, createPayment, handleWebhook, settle, heldAmount, withdraw, addLedger
};
