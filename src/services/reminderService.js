const store = require('../models/store');
const logger = require('../utils/logger');
const NotificationService = require('./notificationService');
const subscriptionService = require('./subscriptionService');
const quoteService = require('./quoteService');
const { slotStart } = require('../utils/dates');

const REMINDER_WINDOW_MS = 24 * 3600000;

const tick = () => {
  const now = new Date();
  store.quoteRequests.forEach(quoteService.refreshExpiry);
  subscriptionService.processRenewals(now);

  store.appointments
    .filter((a) => a.status === 'CONFIRMED' && !a.reminderSent)
    .forEach((a) => {
      const diff = slotStart(a.date, a.time).getTime() - now.getTime();
      if (diff > 0 && diff <= REMINDER_WINDOW_MS) {
        a.reminderSent = true;
        [a.clientId, a.technicianUserId].forEach((userId) =>
          NotificationService.notify({ userId, type: 'REMINDER', title: '⏰ Recordatorio de cita', body: `Tienes una cita el ${a.date} a las ${a.time}`, metadata: { appointmentId: a.id } })
        );
      }
    });
};

const start = (intervalMs = 60000) => {
  const timer = setInterval(() => {
    try {
      tick();
    } catch (error) {
      logger.error('Error en tareas programadas', error.message);
    }
  }, intervalMs);
  timer.unref();
  return timer;
};

module.exports = { start, tick };
