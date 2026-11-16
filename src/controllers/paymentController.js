const crypto = require('crypto');
const store = require('../models/store');
const config = require('../config/env');
const paymentService = require('../services/paymentService');
const subscriptionService = require('../services/subscriptionService');
const technicianService = require('../services/technicianService');
const { AppError, asyncHandler } = require('../utils/errors');

const myTech = (req) => {
  const tech = technicianService.getByUserId(req.user.id);
  if (!tech) throw new AppError('Perfil de negocio no encontrado', 404);
  return tech;
};

const currentUser = (req) => store.users.find((u) => u.id === req.user.id);

const validSignature = (req) => {
  const received = req.headers['x-signature'];
  if (!received || !req.rawBody) return false;
  const expected = crypto.createHmac('sha256', config.payments.webhookSecret).update(req.rawBody).digest('hex');
  const a = Buffer.from(String(received));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// HC-10: la pasarela notifica el resultado; firmado con HMAC-SHA256 en el header x-signature
const webhook = asyncHandler(async (req, res) => {
  if (!validSignature(req)) throw new AppError('Firma del webhook inválida', 401);
  const { payment, duplicate } = paymentService.handleWebhook(req.body);
  res.status(200).json({ success: true, duplicate, data: { reference: payment.reference, status: payment.status, escrowStatus: payment.escrowStatus } });
});

// HI-04: la lista de métodos depende del país del usuario
const listMethods = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: paymentService.allowedMethods(currentUser(req)) });
});

const getPayment = asyncHandler(async (req, res) => {
  const payment = store.payments.find((p) => p.reference === req.params.reference || p.id === Number(req.params.reference));
  if (!payment) throw new AppError('Pago no encontrado', 404);
  const tech = technicianService.getByUserId(req.user.id);
  const allowed = req.user.role === 'ADMIN' || payment.userId === req.user.id || (tech && payment.technicianId === tech.id);
  if (!allowed) throw new AppError('No tienes acceso a este pago', 403);
  res.status(200).json({ success: true, data: payment });
});

// ---- Suscripciones (HT-12) ----
const listPlans = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: subscriptionService.planCatalog() });
});

const getMySubscription = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({
    success: true,
    data: { plan: tech.plan, planDetails: store.settings.plans[tech.plan], subscription: subscriptionService.getSubscription(tech.id) }
  });
});

const subscribe = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const { subscription, payment } = subscriptionService.subscribe(tech, currentUser(req), req.body);
  res.status(201).json({
    success: true,
    message: payment && payment.status === 'PENDING' ? 'Pago pendiente de confirmación' : 'Plan actualizado',
    data: { plan: tech.plan, subscription, payment }
  });
});

const cancelSubscription = asyncHandler(async (req, res) => {
  const subscription = subscriptionService.cancel(myTech(req));
  res.status(200).json({ success: true, message: 'Tu plan seguirá activo hasta el fin del periodo pagado', data: subscription });
});

const listInvoices = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({ success: true, data: store.invoices.filter((i) => i.technicianId === tech.id) });
});

module.exports = { webhook, listMethods, getPayment, listPlans, getMySubscription, subscribe, cancelSubscription, listInvoices };
