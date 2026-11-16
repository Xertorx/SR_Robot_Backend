const WebSocket = require('ws');
const store = require('../models/store');
const logger = require('../utils/logger');
const { resolveUser } = require('../middlewares/authMiddleware');

const userSockets = new Map(); // userId -> Set<ws>   (canal /events: notificaciones y estados)
const rooms = new Map(); // conversationId -> Set<ws> (canal /chat/{id})

const addTo = (map, key, ws) => {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(ws);
};
const removeFrom = (map, key, ws) => {
  const set = map.get(key);
  if (!set) return;
  set.delete(ws);
  if (!set.size) map.delete(key);
};

const send = (ws, type, data) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, data }));
};

const emitToUser = (userId, type, data) => (userSockets.get(userId) || new Set()).forEach((ws) => send(ws, type, data));

const emitToRoom = (conversationId, type, data, exceptWs = null) =>
  (rooms.get(conversationId) || new Set()).forEach((ws) => ws !== exceptWs && send(ws, type, data));

const isUserInRoom = (conversationId, userId) =>
  [...(rooms.get(conversationId) || [])].some((ws) => ws.user.id === userId);

const reject = (socket, code, text) => {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
};

const handleChatMessage = (ws, raw) => {
  const chatService = require('./chatService');
  let payload;
  try {
    payload = JSON.parse(raw.toString());
  } catch (e) {
    return send(ws, 'error', { message: 'Mensaje inválido: se esperaba JSON' });
  }
  const conversation = store.conversations.find((c) => c.id === ws.conversationId);
  if (!conversation) return send(ws, 'error', { message: 'Conversación no encontrada' });

  try {
    if (payload.type === 'message') {
      chatService.addMessage(conversation, ws.user.id, { text: payload.text, attachmentUrl: payload.attachmentUrl });
    } else if (payload.type === 'typing') {
      emitToRoom(conversation.id, 'typing', { conversationId: conversation.id, userId: ws.user.id, isTyping: payload.isTyping !== false }, ws);
    } else if (payload.type === 'read') {
      chatService.markRead(conversation, ws.user.id);
    } else {
      send(ws, 'error', { message: 'Tipo de evento no soportado' });
    }
  } catch (error) {
    send(ws, 'error', { message: error.message });
  }
};

// Se monta sobre el mismo servidor HTTP: WS /chat/{conversationId}?token=... y WS /events?token=...
const attach = (server) => {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch (e) {
      return reject(socket, 400, 'Bad Request');
    }

    const chatMatch = url.pathname.match(/^\/chat\/(\d+)$/);
    if (!chatMatch && url.pathname !== '/events') return reject(socket, 404, 'Not Found');

    let user;
    try {
      const header = req.headers.authorization;
      const token = url.searchParams.get('token') || (header && header.startsWith('Bearer ') ? header.split(' ')[1] : null);
      user = resolveUser(token);
    } catch (e) {
      return reject(socket, 401, 'Unauthorized');
    }

    let conversationId = null;
    if (chatMatch) {
      const chatService = require('./chatService');
      const conversation = store.conversations.find((c) => c.id === Number(chatMatch[1]));
      if (!conversation || !chatService.canAccess(conversation, user)) return reject(socket, 403, 'Forbidden');
      conversationId = conversation.id;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.conversationId = conversationId;
      if (conversationId) addTo(rooms, conversationId, ws);
      else addTo(userSockets, user.id, ws);

      send(ws, 'connected', { userId: user.id, conversationId });
      ws.on('message', (raw) => conversationId && handleChatMessage(ws, raw));
      ws.on('close', () => (conversationId ? removeFrom(rooms, conversationId, ws) : removeFrom(userSockets, user.id, ws)));
      ws.on('error', (err) => logger.warn(`WS error: ${err.message}`));
    });
  });

  return wss;
};

module.exports = { attach, emitToUser, emitToRoom, isUserInRoom };
