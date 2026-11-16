const store = require('../models/store');
const quoteService = require('../services/quoteService');
const matchingService = require('../services/matchingService');
const technicianService = require('../services/technicianService');
const NotificationService = require('../services/notificationService');
const { toMedia } = require('../middlewares/upload');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, parseBool, toNumberOrNull, toInt, paginate } = require('../utils/validate');
const { addHours } = require('../utils/dates');

const URGENCIES = ['LOW', 'NORMAL', 'HIGH'];

const myTech = (req) => {
  const tech = technicianService.getByUserId(req.user.id);
  if (!tech) throw new AppError('Perfil de negocio no encontrado', 404);
  return tech;
};

// HC-06 / HC-08: solicitud abierta (hasta 3 técnicos cercanos) o dirigida. Acepta JSON o multipart con fotos/video
const createQuoteRequest = asyncHandler(async (req, res) => {
  const { deviceType, brandModel, issueDescription, urgency = 'NORMAL', address = null } = req.body;
  requireFields(req.body, ['deviceType', 'brandModel', 'issueDescription']);
  if (!URGENCIES.includes(urgency)) throw new AppError(`urgency inválida. Opciones: ${URGENCIES.join(', ')}`, 400);
  const isHomeService = parseBool(req.body.isHomeService);
  const lat = toNumberOrNull(req.body.lat);
  const lng = toNumberOrNull(req.body.lng);
  const targetId = req.body.targetTechnicianId ? toInt(req.body.targetTechnicianId, 'targetTechnicianId') : null;

  let matches;
  if (targetId) {
    const tech = technicianService.getById(targetId);
    if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
    if (tech.userId === req.user.id) throw new AppError('No puedes cotizar con tu propio negocio', 400);
    if (isHomeService && !tech.homeService) throw new AppError('Este técnico no atiende a domicilio', 400);
    matches = [{ tech }];
  } else {
    matches = matchingService.findMatches({ category: deviceType, lat, lng, isHomeService }).filter(({ tech }) => tech.userId !== req.user.id);
  }

  const request = {
    id: store.nextId('quoteRequests'), clientId: req.user.id, deviceType, brandModel, issueDescription, urgency,
    isHomeService, address, location: { lat, lng }, media: toMedia(req.files || []),
    targetTechnicianId: targetId, matchedTechnicianIds: matches.map(({ tech }) => tech.id), rejectedBy: [],
    status: 'OPEN', acceptedQuoteId: null, createdAt: new Date(),
    expiresAt: addHours(new Date(), store.settings.matching.quoteExpiryHours)
  };
  store.quoteRequests.push(request);

  matches.forEach(({ tech }) =>
    NotificationService.notify({
      userId: tech.userId, type: 'QUOTE', title: '🔨 Nueva solicitud de cotización',
      body: `Equipo: ${brandModel} - Falla: ${issueDescription}`, metadata: { requestId: request.id }
    })
  );

  res.status(201).json({
    success: true,
    message: request.matchedTechnicianIds.length
      ? `Solicitud enviada a ${request.matchedTechnicianIds.length} técnico(s)`
      : 'No encontramos técnicos disponibles cerca; intenta ampliar la búsqueda o cotizar directo',
    data: request
  });
});

const getMyRequests = asyncHandler(async (req, res) => {
  const requests = store.quoteRequests
    .filter((r) => r.clientId === req.user.id)
    .map(quoteService.refreshExpiry)
    .filter((r) => !req.query.status || r.status === req.query.status)
    .sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(requests, req.query);
  res.status(200).json({
    success: true, meta,
    data: items.map((r) => ({ ...r, quotesCount: store.quotes.filter((q) => q.requestId === r.id).length }))
  });
});

// HT-04: solicitudes que recibió el técnico (Nuevas / Cotizadas / Aceptadas / Rechazadas)
const getReceivedRequests = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const wanted = req.query.status ? String(req.query.status).toUpperCase() : null;
  const views = store.quoteRequests
    .filter((r) => r.matchedTechnicianIds.includes(tech.id))
    .map((r) => quoteService.techView(quoteService.refreshExpiry(r), tech))
    .filter((v) => !wanted || v.myStatus === wanted)
    .sort((a, b) => b.id - a.id);
  const allCounts = store.quoteRequests
    .filter((r) => r.matchedTechnicianIds.includes(tech.id))
    .reduce((acc, r) => { const s = quoteService.techRequestStatus(r, tech); acc[s] = (acc[s] || 0) + 1; return acc; }, {});
  const { items, meta } = paginate(views, req.query);
  res.status(200).json({ success: true, meta, counts: allCounts, data: items });
});

const getRequest = asyncHandler(async (req, res) => {
  const request = quoteService.findRequest(req.params.requestId);
  if (request.clientId === req.user.id || req.user.role === 'ADMIN') {
    return res.status(200).json({ success: true, data: request });
  }
  const tech = technicianService.getByUserId(req.user.id);
  if (tech && request.matchedTechnicianIds.includes(tech.id)) {
    return res.status(200).json({ success: true, data: quoteService.techView(request, tech) });
  }
  throw new AppError('No tienes acceso a esta solicitud', 403);
});

// HC-07: cotizaciones recibidas con etiquetas calculadas
const getQuotesForRequest = asyncHandler(async (req, res) => {
  const request = quoteService.findRequest(req.params.requestId);
  if (request.clientId !== req.user.id && req.user.role !== 'ADMIN') throw new AppError('No tienes acceso a esta solicitud', 403);
  const quotes = quoteService.quotesWithLabels(request.id);
  res.status(200).json({
    success: true, count: quotes.length, status: request.status, expiresAt: request.expiresAt,
    waiting: request.status === 'OPEN', data: quotes
  });
});

// HT-05
const submitQuote = asyncHandler(async (req, res) => {
  const requestId = req.params.requestId || req.body.requestId;
  if (!requestId) throw new AppError('Campo requerido: requestId', 400);
  requireFields(req.body, ['price']);
  const request = quoteService.findRequest(requestId);
  const quote = quoteService.submitQuote(request, myTech(req), req.body);
  res.status(201).json({ success: true, message: 'Cotización enviada exitosamente', data: quote });
});

// HT-06: rechazar no afecta la reputación; simplemente desaparece de "Nuevas"
const rejectRequest = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const request = quoteService.findRequest(req.params.requestId);
  if (!request.matchedTechnicianIds.includes(tech.id)) throw new AppError('Esta solicitud no fue enviada a tu negocio', 403);
  if (store.quotes.some((q) => q.requestId === request.id && q.technicianId === tech.id)) {
    throw new AppError('Ya cotizaste esta solicitud', 409);
  }
  if (!request.rejectedBy.includes(tech.id)) request.rejectedBy.push(tech.id);
  res.status(200).json({ success: true, message: 'Solicitud rechazada' });
});

const acceptQuote = asyncHandler(async (req, res) => {
  const request = quoteService.findRequest(req.params.requestId);
  const quote = store.quotes.find((q) => q.id === Number(req.params.quoteId) && q.requestId === request.id);
  if (!quote) throw new AppError('Cotización no encontrada', 404);
  const client = store.users.find((u) => u.id === req.user.id);
  const { order, payment } = quoteService.acceptQuote(request, quote, client, req.body);
  res.status(201).json({ success: true, message: 'Cotización aceptada y orden creada', data: { order, payment, quote } });
});

const cancelRequest = asyncHandler(async (req, res) => {
  const request = quoteService.findRequest(req.params.requestId);
  if (request.clientId !== req.user.id) throw new AppError('No tienes acceso a esta solicitud', 403);
  if (request.status !== 'OPEN') throw new AppError(`La solicitud está ${request.status}`, 409);
  request.status = 'CANCELLED';
  store.quotes.filter((q) => q.requestId === request.id).forEach((q) => { q.status = 'EXPIRED'; });
  res.status(200).json({ success: true, message: 'Solicitud cancelada', data: request });
});

module.exports = {
  createQuoteRequest, getMyRequests, getReceivedRequests, getRequest, getQuotesForRequest, submitQuote, rejectRequest,
  acceptQuote, cancelRequest
};
