const store = require('../models/store');
const NotificationService = require('./notificationService');
const paymentService = require('./paymentService');
const { AppError } = require('../utils/errors');
const { addDaysToDate } = require('../utils/dates');

const PERIOD_DAYS = 30;

const getSubscription = (techId) =>
  store.subscriptions.find((s) => s.technicianId === techId && s.status === 'ACTIVE') || null;

const planCatalog = () =>
  Object.entries(store.settings.plans).map(([code, p]) => ({ code, ...p }));

const nextInvoiceNumber = (id) => `SR-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;

const issueInvoice = (sub, payment) => {
  const id = store.nextId('invoices');
  const invoice = {
    id, number: nextInvoiceNumber(id), subscriptionId: sub.id, technicianId: sub.technicianId, paymentId: payment.id,
    plan: sub.plan, amount: payment.amount, tax: 0, currency: sub.currency, status: 'PAID', issuedAt: new Date()
  };
  store.invoices.push(invoice);
  return invoice;
};

const downgrade = (tech) => { tech.plan = 'BASIC'; };

// Cambiar de plan o contratar uno nuevo; el plan solo cambia cuando la pasarela confirma el cobro
const subscribe = (tech, user, { plan, paymentMethod }) => {
  const def = store.settings.plans[plan];
  if (!def) throw new AppError(`Plan inválido. Opciones: ${Object.keys(store.settings.plans).join(', ')}`, 400);
  const current = getSubscription(tech.id);

  if (def.price === 0) {
    if (current) return { subscription: cancel(tech), payment: null };
    tech.plan = 'BASIC';
    return { subscription: null, payment: null };
  }
  if (tech.plan === plan && current && !current.cancelAtPeriodEnd) throw new AppError('Ya tienes este plan activo', 409);
  if (!paymentMethod) throw new AppError('Campo requerido: paymentMethod', 400);
  paymentService.assertMethod(user, paymentMethod);
  if (paymentMethod === 'CASH') throw new AppError('Las suscripciones no se pagan en efectivo', 400);

  const subscription = {
    id: store.nextId('subscriptions'), technicianId: tech.id, plan, status: 'PENDING', price: def.price,
    currency: paymentService.countryFor(user).currency, paymentMethod, cancelAtPeriodEnd: false,
    currentPeriodStart: null, currentPeriodEnd: null, nextBillingDate: null, createdAt: new Date()
  };
  store.subscriptions.push(subscription);
  const payment = paymentService.createPayment({ type: 'SUBSCRIPTION', subscription, user, amount: def.price, method: paymentMethod });
  return { subscription, payment };
};

const activate = (sub, payment) => {
  const tech = store.technicians.find((t) => t.id === sub.technicianId);
  const now = new Date();
  store.subscriptions
    .filter((s) => s.technicianId === sub.technicianId && s.id !== sub.id && s.status === 'ACTIVE')
    .forEach((s) => { s.status = 'REPLACED'; });
  sub.status = 'ACTIVE';
  sub.currentPeriodStart = now;
  sub.currentPeriodEnd = addDaysToDate(now, PERIOD_DAYS);
  sub.nextBillingDate = sub.currentPeriodEnd;
  tech.plan = sub.plan;
  issueInvoice(sub, payment);
  NotificationService.notify({
    userId: tech.userId, type: 'SUBSCRIPTION', title: '✅ Plan activado',
    body: `Tu plan ${store.settings.plans[sub.plan].name} está activo hasta el ${sub.currentPeriodEnd.toISOString().slice(0, 10)}`
  });
};

const onPaymentApproved = (payment) => {
  const sub = store.subscriptions.find((s) => s.id === payment.subscriptionId);
  if (!sub) return;
  if (payment.renewal && sub.status === 'ACTIVE') {
    sub.currentPeriodStart = sub.currentPeriodEnd;
    sub.currentPeriodEnd = addDaysToDate(sub.currentPeriodEnd, PERIOD_DAYS);
    sub.nextBillingDate = sub.currentPeriodEnd;
    issueInvoice(sub, payment);
    return;
  }
  activate(sub, payment);
};

const onPaymentDeclined = (payment) => {
  const sub = store.subscriptions.find((s) => s.id === payment.subscriptionId);
  if (!sub) return;
  const tech = store.technicians.find((t) => t.id === sub.technicianId);
  sub.status = payment.renewal ? 'PAST_DUE' : 'FAILED';
  if (payment.renewal) downgrade(tech);
  NotificationService.notify({
    userId: tech.userId, type: 'SUBSCRIPTION', title: '⚠️ No pudimos cobrar tu plan',
    body: payment.renewal ? 'Tu plan volvió a Básico. Actualiza tu método de pago.' : 'El pago fue rechazado. Intenta con otro método.'
  });
};

// El plan sigue vigente hasta el fin del periodo ya pagado
const cancel = (tech) => {
  const sub = getSubscription(tech.id);
  if (!sub) throw new AppError('No tienes una suscripción activa', 404);
  sub.cancelAtPeriodEnd = true;
  sub.nextBillingDate = null;
  return sub;
};

// Se ejecuta periódicamente: cierra suscripciones canceladas y cobra las renovaciones vencidas
const processRenewals = (now = new Date()) => {
  store.subscriptions.filter((s) => s.status === 'ACTIVE' && s.currentPeriodEnd <= now).forEach((sub) => {
    const tech = store.technicians.find((t) => t.id === sub.technicianId);
    const user = store.users.find((u) => u.id === tech.userId);
    if (sub.cancelAtPeriodEnd) {
      sub.status = 'CANCELLED';
      downgrade(tech);
      return;
    }
    const pending = store.payments.some((p) => p.subscriptionId === sub.id && p.renewal && p.status === 'PENDING');
    if (pending) return;
    paymentService.createPayment({ type: 'SUBSCRIPTION', subscription: sub, user, amount: sub.price, method: sub.paymentMethod, renewal: true });
  });
};

module.exports = { getSubscription, planCatalog, subscribe, cancel, onPaymentApproved, onPaymentDeclined, processRenewals };
