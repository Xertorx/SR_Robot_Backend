const fs = require('fs');
const path = require('path');
const store = require('../models/store');
const auditService = require('../services/auditService');
const disputeService = require('../services/disputeService');
const technicianService = require('../services/technicianService');
const NotificationService = require('../services/notificationService');
const orderService = require('../services/orderService');
const { PRIVATE_DIR } = require('../middlewares/upload');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, parseBool, paginate, toInt } = require('../utils/validate');

const findTech = (id) => {
  const tech = technicianService.getById(id);
  if (!tech) throw new AppError('Técnico no encontrado', 404);
  return tech;
};

const docsMeta = (tech) => tech.documents.map(({ file, ...d }) => d);

// ---- HA-01: verificación de técnicos ----
const getPendingVerifications = asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'IN_REVIEW').toUpperCase();
  const list = store.technicians
    .filter((t) => status === 'ALL' || t.verificationStatus === status)
    .map((t) => ({ ...t, documents: docsMeta(t) }));
  res.status(200).json({ success: true, count: list.length, data: list });
});

const getVerification = asyncHandler(async (req, res) => {
  const tech = findTech(req.params.id);
  res.status(200).json({ success: true, data: { ...tech, documents: docsMeta(tech) } });
});

// Los documentos son privados: solo el admin los descarga, autenticado
const downloadDocument = asyncHandler(async (req, res) => {
  const tech = findTech(req.params.id);
  const doc = tech.documents.find((d) => d.id === Number(req.params.docId));
  if (!doc) throw new AppError('Documento no encontrado', 404);
  const file = path.join(PRIVATE_DIR, path.basename(doc.file));
  if (!fs.existsSync(file)) throw new AppError('Archivo no disponible', 404);
  auditService.log({ actorId: req.user.id, action: 'DOCUMENT_VIEWED', targetType: 'TECHNICIAN', targetId: tech.id, details: { documentId: doc.id } });
  res.download(file, doc.originalName);
});

const verifyTechnician = asyncHandler(async (req, res) => {
  const tech = findTech(req.params.id);
  const { status, note } = req.body;
  if (!['VERIFIED', 'REJECTED'].includes(status)) throw new AppError('status debe ser VERIFIED o REJECTED', 400);
  if (status === 'REJECTED' && !note) throw new AppError('Indica el motivo del rechazo (note)', 400);

  tech.verificationStatus = status;
  tech.isVerified = status === 'VERIFIED';
  tech.verificationNote = note || null;
  auditService.log({ actorId: req.user.id, action: `TECHNICIAN_${status}`, targetType: 'TECHNICIAN', targetId: tech.id, details: { note } });
  NotificationService.notify({
    userId: tech.userId, type: 'VERIFICATION',
    title: status === 'VERIFIED' ? '✅ Negocio verificado' : '❌ Verificación rechazada',
    body: status === 'VERIFIED' ? 'Ya tienes la insignia Verificado' : `Motivo: ${note}`
  });
  res.status(200).json({ success: true, message: `Verificación de técnico actualizada a: ${status}`, data: { ...tech, documents: docsMeta(tech) } });
});

// ---- HA-03: disputas y dinero retenido ----
const listDisputes = asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const list = store.disputes.filter((d) => !status || d.status === status).sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const getDispute = asyncHandler(async (req, res) => {
  const dispute = store.disputes.find((d) => d.id === Number(req.params.id));
  if (!dispute) throw new AppError('Disputa no encontrada', 404);
  const order = store.orders.find((o) => o.id === dispute.orderId);
  const tech = technicianService.getById(order.technicianId);
  const conversation = store.conversations.find((c) => c.clientId === order.clientId && c.technicianId === order.technicianId);
  res.status(200).json({
    success: true,
    data: {
      dispute, order: orderService.serialize(order), heldAmount: require('../services/paymentService').heldAmount(order),
      chat: conversation ? store.messages.filter((m) => m.conversationId === conversation.id) : [],
      technician: tech ? technicianService.publicView(tech) : null
    }
  });
});

const resolveDispute = asyncHandler(async (req, res) => {
  const dispute = req.params.id
    ? store.disputes.find((d) => d.id === Number(req.params.id))
    : store.disputes.find((d) => d.orderId === toInt(req.body.orderId, 'orderId') && d.status === 'OPEN');
  if (!dispute) throw new AppError('Disputa no encontrada', 404);
  requireFields(req.body, ['decision']);
  const { order, result } = disputeService.resolve(dispute, req.user, req.body);
  res.status(200).json({ success: true, message: `Disputa resuelta mediante ${dispute.resolution.decision}`, data: { dispute, order: orderService.serialize(order), result } });
});

// ---- HA-02: moderación de reseñas y reportes ----
const listReviews = asyncHandler(async (req, res) => {
  let list = store.reviews;
  if (req.query.hidden !== undefined) list = list.filter((r) => r.hidden === parseBool(req.query.hidden));
  const { items, meta } = paginate([...list].sort((a, b) => b.id - a.id), req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const setReviewVisibility = (hidden) =>
  asyncHandler(async (req, res) => {
    const review = store.reviews.find((r) => r.id === Number(req.params.id));
    if (!review) throw new AppError('Reseña no encontrada', 404);
    if (hidden && !req.body.reason) throw new AppError('Indica el motivo (reason)', 400);
    review.hidden = hidden;
    review.moderation = { by: req.user.id, reason: req.body.reason || null, at: new Date() };
    technicianService.recalcRating(review.technicianId);
    auditService.log({ actorId: req.user.id, action: hidden ? 'REVIEW_HIDDEN' : 'REVIEW_RESTORED', targetType: 'REVIEW', targetId: review.id, details: { reason: req.body.reason } });
    res.status(200).json({ success: true, data: review });
  });

const listReports = asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status).toUpperCase() : null;
  const list = store.reports.filter((r) => !status || r.status === status).sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const resolveReport = asyncHandler(async (req, res) => {
  const report = store.reports.find((r) => r.id === Number(req.params.id));
  if (!report) throw new AppError('Reporte no encontrado', 404);
  if (report.status !== 'OPEN') throw new AppError('El reporte ya fue gestionado', 409);
  const status = String(req.body.status || '').toUpperCase();
  if (!['RESOLVED', 'DISMISSED'].includes(status)) throw new AppError('status debe ser RESOLVED o DISMISSED', 400);
  Object.assign(report, { status, resolution: { by: req.user.id, note: req.body.note || '', at: new Date() } });
  auditService.log({ actorId: req.user.id, action: `REPORT_${status}`, targetType: 'REPORT', targetId: report.id, details: { note: req.body.note } });
  NotificationService.notify({ userId: report.reporterId, type: 'REPORT', title: 'Tu reporte fue revisado', body: `Resultado: ${status}` });
  res.status(200).json({ success: true, data: report });
});

// ---- HA-04: configuración dinámica sin desplegar código ----
const isRate = (v) => typeof v === 'number' && v >= 0 && v <= 1;
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;

const getConfig = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: store.settings });
});

const updateConfig = asyncHandler(async (req, res) => {
  const { plans, categories, commissions, shipping, matching, cancellation } = req.body;
  const s = store.settings;
  const next = JSON.parse(JSON.stringify(s));

  if (plans) {
    Object.entries(plans).forEach(([code, p]) => {
      const cur = next.plans[code] || { name: code, price: 0, maxQuotes: 10, discountSpareParts: 0, multiUser: false, features: [] };
      const merged = { ...cur, ...p };
      if (!isNonNegInt(merged.price) || !Number.isInteger(merged.maxQuotes) || merged.maxQuotes < -1 || !isRate(merged.discountSpareParts)) {
        throw new AppError(`Plan ${code} inválido (price ≥ 0, maxQuotes ≥ -1, discountSpareParts entre 0 y 1)`, 400);
      }
      next.plans[code] = merged;
    });
  }
  if (categories) {
    if (!Array.isArray(categories) || !categories.length || categories.some((c) => typeof c !== 'string' || !c.trim())) {
      throw new AppError('categories debe ser una lista de textos', 400);
    }
    next.categories = [...new Set(categories.map((c) => c.trim()))];
  }
  if (commissions) {
    next.commissions = { ...next.commissions, ...commissions };
    const c = next.commissions;
    if (typeof c.transactionEnabled !== 'boolean' || !isRate(c.transactionRate) || !isRate(c.b2bRate)) {
      throw new AppError('commissions inválido (transactionEnabled booleano; tasas entre 0 y 1)', 400);
    }
  }
  if (shipping) {
    next.shipping = { ...next.shipping, ...shipping };
    if (!isNonNegInt(next.shipping.freeFrom) || !isNonNegInt(next.shipping.fee)) throw new AppError('shipping inválido', 400);
  }
  if (matching) {
    next.matching = { ...next.matching, ...matching };
    const m = next.matching;
    if (!Number.isInteger(m.maxTechnicians) || m.maxTechnicians < 1 || !(m.radiusKm > 0) || !(m.quoteExpiryHours > 0)) throw new AppError('matching inválido', 400);
  }
  if (cancellation) {
    next.cancellation = { ...next.cancellation, ...cancellation };
    if (!Object.values(next.cancellation).every(isRate)) throw new AppError('cancellation inválido (tasas entre 0 y 1)', 400);
  }

  store.settings = next;
  auditService.log({ actorId: req.user.id, action: 'CONFIG_UPDATED', targetType: 'SETTINGS', details: Object.keys(req.body) });
  res.status(200).json({ success: true, data: store.settings });
});

// ---- HI-08: abrir un país sin desplegar código ----
const upsertCountry = (isCreate) =>
  asyncHandler(async (req, res) => {
    const code = String(isCreate ? req.body.code : req.params.code || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new AppError('code debe tener 2 letras (ISO 3166)', 400);
    if (isCreate && store.countries[code]) throw new AppError('El país ya existe', 409);
    if (!isCreate && !store.countries[code]) throw new AppError('País no encontrado', 404);
    const country = { code, minorUnits: 2, dataRegion: 'LATAM', active: true, ...(store.countries[code] || {}), ...req.body, code };
    if (isCreate) requireFields(country, ['name', 'locale', 'currency']);
    if (!Array.isArray(country.paymentMethods) || !country.paymentMethods.length) throw new AppError('paymentMethods debe ser una lista', 400);
    store.countries[code] = country;
    auditService.log({ actorId: req.user.id, action: isCreate ? 'COUNTRY_CREATED' : 'COUNTRY_UPDATED', targetType: 'COUNTRY', details: { code } });
    res.status(isCreate ? 201 : 200).json({ success: true, data: country });
  });

const listSuppliers = asyncHandler(async (req, res) => {
  const data = store.users.filter((u) => u.roles.includes('SUPPLIER') && !u.deletedAt).map((u) => ({
    id: u.id, name: u.name, email: u.email, products: store.spareParts.filter((p) => p.supplierId === u.id).length,
    activeProducts: store.spareParts.filter((p) => p.supplierId === u.id && p.active).length
  }));
  res.status(200).json({ success: true, data });
});

const setSupplierCatalogStatus = asyncHandler(async (req, res) => {
  const supplier = store.users.find((u) => u.id === Number(req.params.id) && u.roles.includes('SUPPLIER'));
  if (!supplier) throw new AppError('Proveedor no encontrado', 404);
  const active = parseBool(req.body.active);
  store.spareParts.filter((p) => p.supplierId === supplier.id).forEach((p) => { p.active = active; });
  auditService.log({ actorId: req.user.id, action: active ? 'SUPPLIER_ENABLED' : 'SUPPLIER_DISABLED', targetType: 'SUPPLIER', targetId: supplier.id });
  res.status(200).json({ success: true, message: `Catálogo ${active ? 'activado' : 'desactivado'}` });
});

// ---- HA-05: métricas (filtros por ciudad y fecha; exportable a CSV) ----
const getPlatformMetrics = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date(0);
  const to = req.query.to ? new Date(`${req.query.to}T23:59:59Z`) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new AppError('from/to inválidos (YYYY-MM-DD)', 400);
  const city = req.query.city ? String(req.query.city).toLowerCase() : null;

  const techInCity = (techId) => {
    const t = technicianService.getById(techId);
    return t && (!city || String(t.location.city).toLowerCase() === city);
  };
  const inRange = (d) => d >= from && d <= to;

  const technicians = store.technicians.filter((t) => technicianService.isListed(t) && (!city || String(t.location.city).toLowerCase() === city));
  const requests = store.quoteRequests.filter((r) => inRange(r.createdAt) && r.matchedTechnicianIds.some(techInCity));
  const orders = store.orders.filter((o) => inRange(o.createdAt) && techInCity(o.technicianId));
  const billable = orders.filter((o) => o.state !== 'CANCELADO');
  const activeSubs = store.subscriptions.filter((s) => s.status === 'ACTIVE' && techInCity(s.technicianId));

  const data = {
    filters: { from: req.query.from || null, to: req.query.to || null, city: req.query.city || null },
    supply: { technicians: technicians.length, verifiedTechnicians: technicians.filter((t) => t.isVerified).length, pendingVerifications: technicians.filter((t) => t.verificationStatus === 'IN_REVIEW').length },
    demand: { quoteRequests: requests.length, orders: orders.length, appointments: store.appointments.filter((a) => inRange(a.createdAt) && techInCity(a.technicianId)).length },
    conversion: {
      quoteAcceptanceRate: requests.length ? parseFloat(((requests.filter((r) => r.status === 'ACCEPTED').length / requests.length) * 100).toFixed(1)) : 0,
      completionRate: orders.length ? parseFloat(((orders.filter((o) => o.state === 'ENTREGADO').length / orders.length) * 100).toFixed(1)) : 0
    },
    revenue: {
      mrr: activeSubs.reduce((s, x) => s + x.price, 0), activeSubscriptions: activeSubs.length,
      gmv: billable.reduce((s, o) => s + o.amount, 0), platformCommission: orders.reduce((s, o) => s + (o.platformCommission || 0), 0)
    },
    escrowHeldAmount: technicians.reduce((s, t) => s + t.wallet.held, 0),
    openDisputes: store.disputes.filter((d) => d.status === 'OPEN').length,
    users: { total: store.users.filter((u) => !u.deletedAt).length, clients: store.users.filter((u) => !u.deletedAt && u.roles.includes('CLIENT')).length },
    // Alias de la versión anterior
    totalUsers: store.users.filter((u) => !u.deletedAt).length, activeTechnicians: technicians.length, totalOrders: orders.length,
    mrr: activeSubs.reduce((s, x) => s + x.price, 0)
  };

  if (req.query.format === 'csv') {
    const rows = [];
    const flatten = (obj, prefix = '') => Object.entries(obj).forEach(([k, v]) => {
      if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`);
      else rows.push(`${prefix}${k},${v === null ? '' : v}`);
    });
    flatten(data);
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="metrics.csv"');
    return res.status(200).send(`metric,value\n${rows.join('\n')}`);
  }
  return res.status(200).json({ success: true, data });
});

const getAuditLog = asyncHandler(async (req, res) => {
  const { items, meta } = paginate([...store.auditLogs].sort((a, b) => b.id - a.id), req.query);
  res.status(200).json({ success: true, meta, data: items });
});

module.exports = {
  getPendingVerifications, getVerification, downloadDocument, verifyTechnician, listDisputes, getDispute, resolveDispute,
  listReviews, hideReview: setReviewVisibility(true), restoreReview: setReviewVisibility(false), listReports, resolveReport,
  getConfig, updateConfig, createCountry: upsertCountry(true), updateCountry: upsertCountry(false), listSuppliers,
  setSupplierCatalogStatus, getPlatformMetrics, getAuditLog
};
