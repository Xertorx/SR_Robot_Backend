const store = require('../models/store');
const realtime = require('./realtime');
const NotificationService = require('./notificationService');
const { AppError } = require('../utils/errors');

const canAccess = (conversation, user) => user.id === conversation.clientId || user.id === conversation.technicianUserId;

// Un hilo por cliente y negocio
const getOrCreate = (clientId, technician) => {
  let conversation = store.conversations.find((c) => c.clientId === clientId && c.technicianId === technician.id);
  if (!conversation) {
    conversation = {
      id: store.nextId('conversations'), clientId, technicianId: technician.id, technicianUserId: technician.userId,
      createdAt: new Date(), lastMessageAt: null
    };
    store.conversations.push(conversation);
  }
  return conversation;
};

const unreadCount = (conversation, userId) =>
  store.messages.filter((m) => m.conversationId === conversation.id && m.senderId !== userId && !m.readBy.includes(userId)).length;

const totalUnread = (userId) =>
  store.conversations.filter((c) => c.clientId === userId || c.technicianUserId === userId).reduce((s, c) => s + unreadCount(c, userId), 0);

const addMessage = (conversation, senderId, { text, attachments = [], attachmentUrl = null }) => {
  const clean = typeof text === 'string' ? text.trim() : '';
  if (!clean && !attachments.length && !attachmentUrl) throw new AppError('El mensaje no puede estar vacío', 400);
  if (clean.length > 2000) throw new AppError('El mensaje supera los 2000 caracteres', 400);
  if (attachmentUrl && !/^(\/uploads\/|https:\/\/)/.test(String(attachmentUrl))) {
    throw new AppError('attachmentUrl debe ser una ruta de /uploads o una URL https', 400);
  }

  const message = {
    id: store.nextId('messages'), conversationId: conversation.id, senderId, text: clean,
    attachments, attachmentUrl: attachmentUrl || (attachments[0] ? attachments[0].url : null),
    readBy: [senderId], createdAt: new Date()
  };
  store.messages.push(message);
  conversation.lastMessageAt = message.createdAt;

  realtime.emitToRoom(conversation.id, 'message', message);

  const recipientId = senderId === conversation.clientId ? conversation.technicianUserId : conversation.clientId;
  if (realtime.isUserInRoom(conversation.id, recipientId)) {
    markRead(conversation, recipientId);
  } else {
    realtime.emitToUser(recipientId, 'unread', { conversationId: conversation.id, unread: unreadCount(conversation, recipientId), total: totalUnread(recipientId) });
    const sender = store.users.find((u) => u.id === senderId);
    NotificationService.notify({
      userId: recipientId, type: 'MESSAGE', title: `💬 Mensaje de ${sender ? sender.name : 'Sr Robot'}`,
      body: clean || 'Te envió un archivo', metadata: { conversationId: conversation.id }
    });
  }
  return message;
};

const markRead = (conversation, userId) => {
  let count = 0;
  store.messages.forEach((m) => {
    if (m.conversationId === conversation.id && !m.readBy.includes(userId)) {
      m.readBy.push(userId);
      count += 1;
    }
  });
  if (count) realtime.emitToRoom(conversation.id, 'read', { conversationId: conversation.id, userId });
  return count;
};

module.exports = { canAccess, getOrCreate, unreadCount, totalUnread, addMessage, markRead };
