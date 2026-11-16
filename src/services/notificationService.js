const store = require('../models/store');
const logger = require('../utils/logger');
const realtime = require('./realtime');

class NotificationService {
  // Guarda la notificación en la campana, la emite por WebSocket y simula los canales externos según preferencias
  static notify({ userId, title, body, type = 'GENERAL', metadata = {} }) {
    const user = store.users.find((u) => u.id === userId);
    if (!user || user.deletedAt) return null;

    const prefs = user.preferences || {};
    const channels = ['IN_APP'];
    if (prefs.push !== false) channels.push('PUSH');
    if (prefs.email !== false && user.email) channels.push('EMAIL');
    if (prefs.whatsapp === true && user.phone) channels.push('WHATSAPP'); // requiere opt-in explícito

    const notification = {
      id: store.nextId('notifications'), userId, title, body, type, metadata, channels, read: false, createdAt: new Date()
    };
    store.notifications.push(notification);
    realtime.emitToUser(userId, 'notification', notification);

    channels
      .filter((c) => c !== 'IN_APP')
      .forEach((channel) => logger.info(`🔔 [${channel}] Usuario #${userId}: ${title} - ${body}`));
    return notification;
  }

  static notifyAdmins(payload) {
    store.users.filter((u) => u.roles.includes('ADMIN') && !u.deletedAt).forEach((u) => this.notify({ ...payload, userId: u.id }));
  }

  static async sendNotification(payload) {
    return this.notify(payload);
  }

  static async sendWhatsAppMessage({ phone, template, params }) {
    logger.info(`📲 [WHATSAPP BUSINESS API] Mensaje a ${phone} con plantilla "${template}"`, params);
    return { success: true, channel: 'WHATSAPP' };
  }

  static sendOTP({ identifier, code, purpose }) {
    const channel = identifier.includes('@') ? 'EMAIL' : 'SMS';
    logger.info(`🔐 [OTP ${channel}] ${purpose} para ${identifier}: ${code}`);
  }
}

module.exports = NotificationService;
