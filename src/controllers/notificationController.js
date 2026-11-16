const store = require('../models/store');
const { AppError, asyncHandler } = require('../utils/errors');
const { paginate, parseBool } = require('../utils/validate');

const mine = (user) => store.notifications.filter((n) => n.userId === user.id);

const list = asyncHandler(async (req, res) => {
  let items = mine(req.user);
  if (req.query.unread !== undefined && parseBool(req.query.unread)) items = items.filter((n) => !n.read);
  items = items.sort((a, b) => b.id - a.id);
  const page = paginate(items, req.query);
  res.status(200).json({ success: true, unreadCount: mine(req.user).filter((n) => !n.read).length, meta: page.meta, data: page.items });
});

const markRead = asyncHandler(async (req, res) => {
  const notification = mine(req.user).find((n) => n.id === Number(req.params.id));
  if (!notification) throw new AppError('Notificación no encontrada', 404);
  notification.read = true;
  res.status(200).json({ success: true, data: notification });
});

// "Leer todas"
const markAllRead = asyncHandler(async (req, res) => {
  const unread = mine(req.user).filter((n) => !n.read);
  unread.forEach((n) => { n.read = true; });
  res.status(200).json({ success: true, marked: unread.length });
});

const getPreferences = asyncHandler(async (req, res) => {
  const user = store.users.find((u) => u.id === req.user.id);
  res.status(200).json({ success: true, data: user.preferences });
});

// WhatsApp requiere opt-in explícito: solo se activa si el usuario lo pide y tiene celular
const updatePreferences = asyncHandler(async (req, res) => {
  const user = store.users.find((u) => u.id === req.user.id);
  ['push', 'email', 'whatsapp'].forEach((key) => {
    if (req.body[key] === undefined) return;
    if (typeof req.body[key] !== 'boolean') throw new AppError(`${key} debe ser booleano`, 400);
    if (key === 'whatsapp' && req.body[key] && !user.phone) throw new AppError('Registra un celular para activar WhatsApp', 400);
    user.preferences[key] = req.body[key];
  });
  if (req.body.whatsapp === true) user.consents.push({ type: 'WHATSAPP', version: '1.0', granted: true, acceptedAt: new Date(), ip: req.ip });
  res.status(200).json({ success: true, data: user.preferences });
});

module.exports = { list, markRead, markAllRead, getPreferences, updatePreferences };
