const logger = require('../utils/logger');

class NotificationService {
  static async sendNotification({ userId, title, body, type = 'PUSH', metadata = {} }) {
    logger.info(`🔔 [NOTIFICACIÓN ${type}] Para Usuario ID ${userId}: ${title} - ${body}`, metadata);
    return { success: true, sentAt: new Date() };
  }

  static async sendWhatsAppMessage({ phone, template, params }) {
    logger.info(`📲 [WHATSAPP BUSINESS API] Enviando mensaje a ${phone} con plantilla "${template}"`, params);
    return { success: true, channel: 'WHATSAPP' };
  }
}

module.exports = NotificationService;
