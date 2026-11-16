const store = require('../models/store');
const NotificationService = require('./notificationService');
const orderService = require('./orderService');
const technicianService = require('./technicianService');
const { calculateDistanceKm } = require('../utils/geoUtils');
const { AppError } = require('../utils/errors');

const parseHours = (estimatedTime) => {
  const m = /(\d+(?:[.,]\d+)?)\s*(horas?|hrs?|h|d[ií]as?)/i.exec(String(estimatedTime || ''));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return /^d/i.test(m[2]) ? n * 24 : n;
};

// Marca como vencida una solicitud abierta cuyo plazo (p. ej. 24 h) ya pasó
const refreshExpiry = (request) => {
  if (request.status === 'OPEN' && request.expiresAt <= new Date()) {
    request.status = 'EXPIRED';
    store.quotes.filter((q) => q.requestId === request.id && q.status === 'PENDING').forEach((q) => { q.status = 'EXPIRED'; });
    NotificationService.notify({
      userId: request.clientId, type: 'QUOTE', title: '⌛ Solicitud vencida',
      body: `Tu solicitud #${request.id} venció sin que elijas una cotización`, metadata: { requestId: request.id }
    });
  }
  return request;
};

const findRequest = (id) => {
  const request = store.quoteRequests.find((r) => r.id === Number(id));
  if (!request) throw new AppError('Solicitud no encontrada', 404);
  return refreshExpiry(request);
};

const LABELS = { BEST_PRICE: 'Mejor precio', BEST_RATED: 'Mejor calificado', FASTEST: 'Más rápido' };

const quotesWithLabels = (requestId) => {
  const quotes = store.quotes.filter((q) => q.requestId === requestId);
  const pick = (list, score, better) => {
    const valid = list.filter((q) => score(q) !== null && score(q) !== undefined);
    if (!valid.length) return null;
    return valid.reduce((best, q) => (better(score(q), score(best)) ? q : best), valid[0]);
  };
  const best = {
    BEST_PRICE: pick(quotes, (q) => q.price, (a, b) => a < b),
    BEST_RATED: pick(quotes, (q) => q.technicianRating, (a, b) => a > b),
    FASTEST: pick(quotes, (q) => q.estimatedHours, (a, b) => a < b)
  };
  return quotes.map((q) => {
    const tags = Object.keys(best).filter((k) => best[k] && best[k].id === q.id);
    return { ...q, tags, labels: tags.map((t) => LABELS[t]) };
  });
};

const techRequestStatus = (request, tech) => {
  if (request.rejectedBy.includes(tech.id)) return 'REJECTED';
  const mine = store.quotes.find((q) => q.requestId === request.id && q.technicianId === tech.id);
  if (request.status === 'ACCEPTED') return mine && mine.status === 'ACCEPTED' ? 'ACCEPTED' : 'CLOSED';
  if (request.status !== 'OPEN') return 'CLOSED';
  return mine ? 'QUOTED' : 'NEW';
};

const techView = (request, tech) => {
  const client = store.users.find((u) => u.id === request.clientId);
  const distanceKm = calculateDistanceKm(request.location.lat, request.location.lng, tech.location.lat, tech.location.lng);
  const { clientId, matchedTechnicianIds, rejectedBy, ...rest } = request;
  return {
    ...rest, clientName: client ? client.name : null, distanceKm,
    myStatus: techRequestStatus(request, tech),
    myQuote: store.quotes.find((q) => q.requestId === request.id && q.technicianId === tech.id) || null
  };
};

const submitQuote = (request, tech, { price, estimatedTime, estimatedHours, warrantyDays, message }) => {
  if (!request.matchedTechnicianIds.includes(tech.id)) throw new AppError('Esta solicitud no fue enviada a tu negocio', 403);
  if (!tech.isVerified) throw new AppError('Tu negocio debe estar verificado para cotizar', 403);
  if (request.status !== 'OPEN') throw new AppError(`La solicitud está ${request.status}`, 409);
  if (request.rejectedBy.includes(tech.id)) throw new AppError('Ya rechazaste esta solicitud', 409);
  if (store.quotes.some((q) => q.requestId === request.id && q.technicianId === tech.id)) {
    throw new AppError('Ya enviaste una cotización para esta solicitud', 409);
  }
  const amount = Number(price);
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('price debe ser un entero positivo', 400);
  const hours = estimatedHours !== undefined && estimatedHours !== '' ? Number(estimatedHours) : parseHours(estimatedTime);
  if (!estimatedTime && !hours) throw new AppError('Indica el tiempo estimado (estimatedTime o estimatedHours)', 400);
  const warranty = warrantyDays === undefined ? 90 : Number(warrantyDays);
  if (!Number.isInteger(warranty) || warranty < 0) throw new AppError('warrantyDays inválido', 400);

  const quote = {
    id: store.nextId('quotes'), requestId: request.id, technicianId: tech.id, technicianUserId: tech.userId,
    technicianName: tech.businessName, technicianRating: tech.rating, price: amount,
    estimatedTime: estimatedTime || `${hours} horas`, estimatedHours: Number.isFinite(hours) ? hours : null,
    warrantyDays: warranty, message: message || '', status: 'PENDING', createdAt: new Date()
  };
  store.quotes.push(quote);
  NotificationService.notify({
    userId: request.clientId, type: 'QUOTE', title: '📩 Cotización recibida',
    body: `${tech.businessName} te cotizó por ${amount}`, metadata: { requestId: request.id, quoteId: quote.id }
  });
  return quote;
};

const acceptQuote = (request, quote, client, { paymentMethod, equipmentId = null }) => {
  if (request.clientId !== client.id) throw new AppError('No tienes acceso a esta solicitud', 403);
  if (request.status !== 'OPEN') throw new AppError(`La solicitud está ${request.status}`, 409);
  if (quote.status !== 'PENDING') throw new AppError(`La cotización está ${quote.status}`, 409);
  if (!paymentMethod) throw new AppError('Campo requerido: paymentMethod', 400);

  const tech = technicianService.getById(quote.technicianId);
  const { order, payment } = orderService.create({
    client, tech, serviceName: `Reparación ${request.deviceType} ${request.brandModel}`.trim(), amount: quote.price,
    isHomeService: request.isHomeService, paymentMethod, address: request.address, equipmentId,
    warrantyDays: quote.warrantyDays, source: 'QUOTE', quoteId: quote.id, requestId: request.id,
    estimatedHours: quote.estimatedHours, description: request.issueDescription
  });

  request.status = 'ACCEPTED';
  request.acceptedQuoteId = quote.id;
  quote.status = 'ACCEPTED';
  store.quotes.filter((q) => q.requestId === request.id && q.id !== quote.id).forEach((q) => { q.status = 'REJECTED'; });
  store.quotes.filter((q) => q.requestId === request.id && q.id !== quote.id).forEach((q) =>
    NotificationService.notify({ userId: q.technicianUserId, type: 'QUOTE', title: 'Cotización no seleccionada', body: `El cliente eligió otra oferta para la solicitud #${request.id}` })
  );
  return { order, payment };
};

module.exports = { refreshExpiry, findRequest, quotesWithLabels, techView, techRequestStatus, submitQuote, acceptQuote, parseHours };
