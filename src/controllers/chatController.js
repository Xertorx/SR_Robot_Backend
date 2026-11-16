const store = require('../models/store');
const chatService = require('../services/chatService');
const technicianService = require('../services/technicianService');
const { toMedia } = require('../middlewares/upload');
const { AppError, asyncHandler } = require('../utils/errors');
const { toInt, paginate } = require('../utils/validate');

const findConversation = (id, user) => {
  const conversation = store.conversations.find((c) => c.id === Number(id));
  if (!conversation) throw new AppError('Conversación no encontrada', 404);
  if (!chatService.canAccess(conversation, user)) throw new AppError('No tienes acceso a esta conversación', 403);
  return conversation;
};

const describe = (conversation, user) => {
  const messages = store.messages.filter((m) => m.conversationId === conversation.id);
  const last = messages[messages.length - 1] || null;
  const otherIsTech = user.id === conversation.clientId;
  const technician = technicianService.getById(conversation.technicianId);
  const other = store.users.find((u) => u.id === (otherIsTech ? conversation.technicianUserId : conversation.clientId));
  return {
    ...conversation,
    counterpart: { userId: other ? other.id : null, name: otherIsTech && technician ? technician.businessName : other ? other.name : null },
    lastMessage: last, unread: chatService.unreadCount(conversation, user.id)
  };
};

// Un técnico solo puede escribir a clientes con los que tiene una solicitud o una orden
const hasRelation = (tech, clientId) =>
  store.orders.some((o) => o.technicianId === tech.id && o.clientId === clientId) ||
  store.quoteRequests.some((r) => r.clientId === clientId && r.matchedTechnicianIds.includes(tech.id));

const getConversations = asyncHandler(async (req, res) => {
  const list = store.conversations
    .filter((c) => chatService.canAccess(c, req.user))
    .map((c) => describe(c, req.user))
    .sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));
  res.status(200).json({ success: true, totalUnread: chatService.totalUnread(req.user.id), data: list });
});

// Crea (o reutiliza) el hilo cliente-negocio
const createConversation = asyncHandler(async (req, res) => {
  if (req.user.role === 'TECHNICIAN') {
    const tech = technicianService.getByUserId(req.user.id);
    const clientId = toInt(req.body.clientId, 'clientId');
    if (!tech || !hasRelation(tech, clientId)) throw new AppError('Solo puedes escribir a clientes con una solicitud u orden', 403);
    return res.status(201).json({ success: true, data: describe(chatService.getOrCreate(clientId, tech), req.user) });
  }
  const tech = technicianService.getById(toInt(req.body.technicianId, 'technicianId'));
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
  if (tech.userId === req.user.id) throw new AppError('No puedes chatear contigo mismo', 400);
  res.status(201).json({ success: true, data: describe(chatService.getOrCreate(req.user.id, tech), req.user) });
});

const getMessages = asyncHandler(async (req, res) => {
  const conversation = findConversation(req.params.conversationId, req.user);
  chatService.markRead(conversation, req.user.id);
  const messages = store.messages.filter((m) => m.conversationId === conversation.id);
  const { items, meta } = paginate(messages, { limit: 50, ...req.query });
  res.status(200).json({ success: true, meta, data: items });
});

const sendMessage = asyncHandler(async (req, res) => {
  const conversation = findConversation(req.params.conversationId, req.user);
  const message = chatService.addMessage(conversation, req.user.id, {
    text: req.body.text, attachments: toMedia(req.files || []), attachmentUrl: req.body.attachmentUrl
  });
  res.status(201).json({ success: true, data: message });
});

const markRead = asyncHandler(async (req, res) => {
  const conversation = findConversation(req.params.conversationId, req.user);
  res.status(200).json({ success: true, marked: chatService.markRead(conversation, req.user.id) });
});

module.exports = { getConversations, createConversation, getMessages, sendMessage, markRead };
