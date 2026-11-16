const store = require('../models/store');
const technicianService = require('../services/technicianService');
const availabilityService = require('../services/availabilityService');
const paymentService = require('../services/paymentService');
const NotificationService = require('../services/notificationService');
const { calculateDistanceKm } = require('../utils/geoUtils');
const { AppError, asyncHandler } = require('../utils/errors');
const {
  requireFields, toPositiveInt, parseBool, toNumberOrNull, stripAccents, paginate
} = require('../utils/validate');
const { isValidDate, isValidTime, toMinutes, todayStr, DAY_KEYS } = require('../utils/dates');
const { matchesCategory } = require('../services/matchingService');

const myTech = (req) => {
  const tech = technicianService.getByUserId(req.user.id);
  if (!tech) throw new AppError('Perfil de negocio no encontrado', 404);
  return tech;
};

// HC-02 / HC-03: búsqueda geoespacial con filtros, orden y paginación
const getTechnicians = asyncHandler(async (req, res) => {
  const { cat, home, verified, minRating, q, sort = 'distance' } = req.query;
  const lat = toNumberOrNull(req.query.lat);
  const lng = toNumberOrNull(req.query.lng);
  const radius = toNumberOrNull(req.query.radius);
  const hasLocation = lat !== null && lng !== null;
  const text = stripAccents(q);

  let results = store.technicians.filter(technicianService.isListed).map((tech) => ({
    tech, distanceKm: hasLocation ? calculateDistanceKm(lat, lng, tech.location.lat, tech.location.lng) : null
  }));

  if (cat) results = results.filter(({ tech }) => matchesCategory(tech, cat));
  if (parseBool(home)) results = results.filter(({ tech }) => tech.homeService);
  if (parseBool(verified)) results = results.filter(({ tech }) => tech.isVerified);
  if (minRating !== undefined) {
    const min = toNumberOrNull(minRating);
    if (min === null) throw new AppError('minRating inválido', 400);
    results = results.filter(({ tech }) => tech.rating >= min);
  }
  if (radius !== null && hasLocation) results = results.filter(({ distanceKm }) => distanceKm <= radius);
  if (text) {
    results = results.filter(({ tech }) =>
      [tech.businessName, tech.description, ...tech.categories, ...tech.services.filter((s) => s.active).map((s) => s.name)]
        .some((field) => stripAccents(field).includes(text))
    );
  }

  const byDistance = (a, b) => (a.distanceKm === null) - (b.distanceKm === null) || a.distanceKm - b.distanceKm;
  if (sort === 'rating') results.sort((a, b) => b.tech.rating - a.tech.rating || b.tech.reviewsCount - a.tech.reviewsCount);
  else results.sort(byDistance);

  const { items, meta } = paginate(results, req.query);
  res.status(200).json({
    success: true, count: meta.total, meta,
    data: items.map(({ tech, distanceKm }) => technicianService.publicView(tech, { distanceKm }))
  });
});

const getTechnicianById = asyncHandler(async (req, res) => {
  const tech = technicianService.getById(req.params.id);
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);

  store.profileViews.push({ technicianId: tech.id, viewerId: req.user ? req.user.id : null, at: new Date() });
  const reviews = technicianService.visibleReviews(tech.id).sort((a, b) => b.createdAt - a.createdAt);
  const lat = toNumberOrNull(req.query.lat);
  const lng = toNumberOrNull(req.query.lng);

  res.status(200).json({
    success: true,
    data: technicianService.publicView(tech, {
      distanceKm: lat !== null && lng !== null ? calculateDistanceKm(lat, lng, tech.location.lat, tech.location.lng) : null,
      reviews, ratingDistribution: technicianService.ratingDistribution(tech.id),
      isFavorite: req.user ? store.favorites.some((f) => f.userId === req.user.id && f.technicianId === tech.id) : false
    })
  });
});

const getReviews = asyncHandler(async (req, res) => {
  const tech = technicianService.getById(req.params.id);
  if (!tech) throw new AppError('Técnico no encontrado', 404);
  const { items, meta } = paginate(technicianService.visibleReviews(tech.id).sort((a, b) => b.createdAt - a.createdAt), req.query);
  res.status(200).json({ success: true, meta, ratingDistribution: technicianService.ratingDistribution(tech.id), data: items });
});

// HC-09: horas libres reales por técnico
const getAvailability = asyncHandler(async (req, res) => {
  const tech = technicianService.getById(req.params.id);
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
  const date = req.query.date || todayStr();
  availabilityService.assertBookableDate(date);
  const slots = availabilityService.getSlots(tech, date);
  res.status(200).json({
    success: true, date, technicianId: tech.id, slots, availableSlots: slots.filter((s) => s.available).map((s) => s.time)
  });
});

// ---- Mi negocio (HT-01, HT-02, HT-03) ----
const getMyProfile = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({ success: true, data: { ...tech, documents: tech.documents.map(({ file, ...d }) => d) } });
});

const updateMyProfile = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const { businessName, description, categories, homeService, available, address, city, responseTime } = req.body;
  if (businessName !== undefined) {
    if (!String(businessName).trim()) throw new AppError('businessName no puede estar vacío', 400);
    tech.businessName = String(businessName).trim();
  }
  if (description !== undefined) tech.description = String(description);
  if (Array.isArray(categories)) {
    const clean = [...new Set(categories.map((c) => String(c).trim()).filter(Boolean))];
    if (!clean.length) throw new AppError('Indica al menos una categoría', 400);
    tech.categories = clean;
    tech.category = clean[0];
  }
  if (homeService !== undefined) tech.homeService = parseBool(homeService);
  if (available !== undefined) tech.available = parseBool(available);
  if (responseTime !== undefined) tech.responseTime = String(responseTime);
  if (req.body.homeExtraFee !== undefined) {
    const fee = toNumberOrNull(req.body.homeExtraFee);
    if (fee === null || fee < 0) throw new AppError('homeExtraFee inválido', 400);
    tech.homeExtraFee = fee;
  }
  if (req.body.coverageRadiusKm !== undefined) {
    const radius = toNumberOrNull(req.body.coverageRadiusKm);
    if (radius === null || radius <= 0) throw new AppError('coverageRadiusKm inválido', 400);
    tech.coverageRadiusKm = radius;
  }
  if (req.body.lat !== undefined || req.body.lng !== undefined) {
    const lat = toNumberOrNull(req.body.lat);
    const lng = toNumberOrNull(req.body.lng);
    if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new AppError('Coordenadas inválidas', 400);
    tech.location.lat = lat;
    tech.location.lng = lng;
  }
  if (address !== undefined) tech.location.address = String(address);
  if (city !== undefined) tech.location.city = String(city);
  res.status(200).json({ success: true, data: tech });
});

const getSchedule = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({ success: true, data: { schedule: tech.schedule, blocks: tech.blocks } });
});

// body.schedule = { mon: { enabled, open: "08:00", close: "18:00" }, ... }
const updateSchedule = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const incoming = req.body.schedule;
  if (!incoming || typeof incoming !== 'object') throw new AppError('Campo requerido: schedule', 400);
  Object.keys(incoming).forEach((key) => {
    if (!DAY_KEYS.includes(key)) throw new AppError(`Día inválido: ${key}. Usa ${DAY_KEYS.join(', ')}`, 400);
    const day = { ...tech.schedule[key], ...incoming[key] };
    day.enabled = parseBool(day.enabled);
    if (!isValidTime(day.open) || !isValidTime(day.close) || toMinutes(day.open) >= toMinutes(day.close)) {
      throw new AppError(`Horario inválido para ${key}`, 400);
    }
    tech.schedule[key] = { enabled: day.enabled, open: day.open, close: day.close };
  });
  res.status(200).json({ success: true, data: tech.schedule });
});

const addBlock = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const { date, start, end, reason = '' } = req.body;
  requireFields(req.body, ['date', 'start', 'end']);
  if (!isValidDate(date) || !isValidTime(start) || !isValidTime(end) || toMinutes(start) >= toMinutes(end)) {
    throw new AppError('Bloqueo inválido: usa date YYYY-MM-DD y start/end HH:MM', 400);
  }
  const block = { id: store.nextId('blocks'), date, start, end, reason };
  tech.blocks.push(block);
  res.status(201).json({ success: true, data: block });
});

const removeBlock = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const index = tech.blocks.findIndex((b) => b.id === Number(req.params.blockId));
  if (index === -1) throw new AppError('Bloqueo no encontrado', 404);
  tech.blocks.splice(index, 1);
  res.status(200).json({ success: true, message: 'Bloqueo eliminado' });
});

// ---- CRUD de servicios (HT-02) ----
const parseService = (body, partial = false) => {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (!body.name || !String(body.name).trim()) throw new AppError('Campo requerido: name', 400);
    out.name = String(body.name).trim();
  }
  if (!partial || body.priceFrom !== undefined) out.priceFrom = toPositiveInt(body.priceFrom, 'priceFrom');
  if (!partial || body.estimatedTime !== undefined) {
    if (!body.estimatedTime) throw new AppError('Campo requerido: estimatedTime', 400);
    out.estimatedTime = String(body.estimatedTime);
  }
  if (body.estimatedHours !== undefined) out.estimatedHours = toNumberOrNull(body.estimatedHours);
  if (body.warrantyDays !== undefined) {
    const days = Number(body.warrantyDays);
    if (!Number.isInteger(days) || days < 0) throw new AppError('warrantyDays inválido', 400);
    out.warrantyDays = days;
  }
  return out;
};

const listMyServices = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: myTech(req).services });
});

const addService = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const service = { id: store.nextId('services'), estimatedHours: null, warrantyDays: 90, active: true, ...parseService(req.body) };
  tech.services.push(service);
  res.status(201).json({ success: true, message: 'Servicio agregado exitosamente', data: service });
});

const findService = (tech, id) => {
  const service = tech.services.find((s) => s.id === Number(id));
  if (!service) throw new AppError('Servicio no encontrado', 404);
  return service;
};

const updateService = asyncHandler(async (req, res) => {
  const service = findService(myTech(req), req.params.serviceId);
  Object.assign(service, parseService(req.body, true));
  if (req.body.active !== undefined) service.active = parseBool(req.body.active);
  res.status(200).json({ success: true, data: service });
});

// Se desactiva (no se borra) para no romper órdenes y citas históricas
const deleteService = asyncHandler(async (req, res) => {
  const service = findService(myTech(req), req.params.serviceId);
  service.active = false;
  res.status(200).json({ success: true, message: 'Servicio desactivado', data: service });
});

// ---- Verificación (HT-01) ----
const DOC_TYPES = ['ID', 'RUT', 'LOCAL_PHOTO'];

const uploadDocuments = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const files = req.files || [];
  if (!files.length) throw new AppError('Adjunta al menos un archivo en el campo "documents"', 400);
  const types = [].concat(req.body.type || req.body.types || []);
  files.forEach((f, i) => {
    const type = String(types[i] || types[0] || 'ID').toUpperCase();
    if (!DOC_TYPES.includes(type)) throw new AppError(`Tipo de documento inválido. Opciones: ${DOC_TYPES.join(', ')}`, 400);
    tech.documents.push({
      id: store.nextId('documents'), type, file: f.filename, originalName: f.originalname, size: f.size, uploadedAt: new Date()
    });
  });
  res.status(201).json({ success: true, data: tech.documents.map(({ file, ...d }) => d) });
});

const submitVerification = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  if (tech.isVerified) throw new AppError('Tu negocio ya está verificado', 409);
  if (tech.verificationStatus === 'IN_REVIEW') throw new AppError('Tu negocio ya está en revisión', 409);
  if (!tech.documents.some((d) => d.type === 'ID' || d.type === 'RUT')) {
    throw new AppError('Sube tu documento de identidad o RUT antes de enviar a verificación', 400);
  }
  if (!tech.categories.length || !tech.services.some((s) => s.active)) {
    throw new AppError('Define al menos una categoría y un servicio activo', 400);
  }
  tech.verificationStatus = 'IN_REVIEW';
  tech.verificationNote = null;
  NotificationService.notifyAdmins({ type: 'VERIFICATION', title: '🪪 Técnico por verificar', body: `${tech.businessName} envió su documentación`, metadata: { technicianId: tech.id } });
  res.status(200).json({ success: true, message: 'Enviado a verificación', data: { verificationStatus: tech.verificationStatus } });
});

// ---- Billetera (HT-14) ----
const getWallet = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({ success: true, data: tech.wallet });
});

const getLedger = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const entries = store.ledger.filter((e) => e.technicianId === tech.id).sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(entries, req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const createWithdrawal = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const amount = toPositiveInt(req.body.amount);
  const { destination } = req.body;
  if (!destination || !['BANK', 'NEQUI', 'DAVIPLATA'].includes(destination.type) || !destination.account) {
    throw new AppError('destination debe incluir type (BANK | NEQUI | DAVIPLATA) y account', 400);
  }
  const withdrawal = paymentService.withdraw(tech, { amount, destination });
  res.status(201).json({ success: true, data: withdrawal, wallet: tech.wallet });
});

const listWithdrawals = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  res.status(200).json({ success: true, data: store.withdrawals.filter((w) => w.technicianId === tech.id) });
});

// ---- Analítica (HT-11) ----
const getAnalytics = asyncHandler(async (req, res) => {
  const tech = myTech(req);
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const now = Date.now();
  const periodStart = now - days * 86400000;
  const prevStart = periodStart - days * 86400000;

  const delivered = store.orders.filter((o) => o.technicianId === tech.id && o.state === 'ENTREGADO');
  const deliveredAt = (o) => o.history.find((h) => h.state === 'ENTREGADO').timestamp.getTime();
  const revenueIn = (from, to) => delivered.filter((o) => deliveredAt(o) >= from && deliveredAt(o) < to).reduce((s, o) => s + o.amount, 0);

  const revenue = revenueIn(periodStart, now + 1);
  const previousRevenue = revenueIn(prevStart, periodStart);

  const weeks = Math.ceil(days / 7);
  const weekly = Array.from({ length: Math.min(weeks, 12) }, (_, i) => {
    const to = now - i * 7 * 86400000;
    return { weekStart: new Date(to - 7 * 86400000).toISOString().slice(0, 10), revenue: revenueIn(to - 7 * 86400000, to + 1) };
  }).reverse();

  const views = store.profileViews.filter((v) => v.technicianId === tech.id && v.at.getTime() >= periodStart).length;
  const ordersCreated = store.orders.filter((o) => o.technicianId === tech.id && o.createdAt.getTime() >= periodStart).length;
  const requests = store.quoteRequests.filter((r) => r.matchedTechnicianIds.includes(tech.id) && r.createdAt.getTime() >= periodStart);
  const quotesSent = store.quotes.filter((q) => q.technicianId === tech.id && q.createdAt.getTime() >= periodStart);

  res.status(200).json({
    success: true,
    data: {
      periodDays: days, currency: 'COP', totalRevenue: revenue, previousRevenue,
      revenueChangePct: previousRevenue ? parseFloat((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1)) : null,
      weeklyRevenue: weekly,
      completedOrders: delivered.filter((o) => deliveredAt(o) >= periodStart).length,
      profileViews: views, requestsReceived: requests.length, quotesSent: quotesSent.length,
      quotesAccepted: quotesSent.filter((q) => q.status === 'ACCEPTED').length,
      conversionRate: views ? parseFloat(((ordersCreated / views) * 100).toFixed(1)) : 0,
      rating: tech.rating, reviewsCount: tech.reviewsCount, plan: tech.plan
    }
  });
});

module.exports = {
  getTechnicians, getTechnicianById, getReviews, getAvailability, getMyProfile, updateMyProfile, getSchedule, updateSchedule,
  addBlock, removeBlock, listMyServices, addService, updateService, deleteService, uploadDocuments, submitVerification,
  getWallet, getLedger, createWithdrawal, listWithdrawals, getAnalytics
};
