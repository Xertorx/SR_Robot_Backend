const store = require('../models/store');
const disputeService = require('../services/disputeService');
const orderService = require('../services/orderService');
const NotificationService = require('../services/notificationService');
const { toMedia } = require('../middlewares/upload');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, paginate } = require('../utils/validate');

const findDispute = (id, user) => {
  const dispute = store.disputes.find((d) => d.id === Number(id));
  if (!dispute || !disputeService.canView(dispute, user)) throw new AppError('Disputa no encontrada', 404);
  return dispute;
};

const listMine = asyncHandler(async (req, res) => {
  const list = store.disputes.filter((d) => disputeService.canView(d, req.user)).sort((a, b) => b.id - a.id);
  const { items, meta } = paginate(list, req.query);
  res.status(200).json({ success: true, meta, data: items });
});

const getOne = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: findDispute(req.params.id, req.user) });
});

// Seguimiento del caso: cliente, técnico y admin agregan notas/evidencias
const addComment = asyncHandler(async (req, res) => {
  const dispute = findDispute(req.params.id, req.user);
  if (dispute.status !== 'OPEN') throw new AppError('La disputa ya fue resuelta', 409);
  disputeService.addUpdate(dispute, req.user, { note: req.body.note, media: toMedia(req.files || []) });
  const order = store.orders.find((o) => o.id === dispute.orderId);
  [order.clientId, order.technicianUserId].filter((id) => id !== req.user.id).forEach((userId) =>
    NotificationService.notify({ userId, type: 'DISPUTE', title: '⚖️ Novedad en la disputa', body: `Orden #${order.id}`, metadata: { disputeId: dispute.id } })
  );
  res.status(201).json({ success: true, data: dispute });
});

const TARGETS = ['REVIEW', 'USER', 'TECHNICIAN', 'ORDER', 'MESSAGE'];

// HC-21 / HA-02: reportes de contenido o conducta
const createReport = asyncHandler(async (req, res) => {
  requireFields(req.body, ['targetType', 'targetId', 'reason']);
  const targetType = String(req.body.targetType).toUpperCase();
  if (!TARGETS.includes(targetType)) throw new AppError(`targetType inválido. Opciones: ${TARGETS.join(', ')}`, 400);
  if (targetType === 'ORDER') orderService.assertAccess(orderService.findOrder(req.body.targetId), req.user);

  const report = {
    id: store.nextId('reports'), reporterId: req.user.id, targetType, targetId: Number(req.body.targetId),
    reason: String(req.body.reason), description: req.body.description || '', status: 'OPEN', createdAt: new Date()
  };
  store.reports.push(report);
  NotificationService.notifyAdmins({ type: 'REPORT', title: '🚩 Nuevo reporte', body: `${targetType} #${report.targetId}: ${report.reason}`, metadata: { reportId: report.id } });
  res.status(201).json({ success: true, data: report });
});

const listMyReports = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: store.reports.filter((r) => r.reporterId === req.user.id) });
});

module.exports = { listMine, getOne, addComment, createReport, listMyReports };
