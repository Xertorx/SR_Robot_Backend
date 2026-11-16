const store = require('../models/store');
const { AppError } = require('../utils/errors');
const { isValidDate, todayStr, addDays, dayKey, toMinutes, fromMinutes, slotStart } = require('../utils/dates');

const SLOT_MINUTES = 60;
const MIN_LEAD_MINUTES = 30;
const MAX_DAYS_AHEAD = 30;
const OCCUPYING = ['CONFIRMED', 'IN_PROGRESS'];

const assertBookableDate = (date) => {
  if (!isValidDate(date)) throw new AppError('Fecha inválida. Usa el formato YYYY-MM-DD', 400);
  if (date < todayStr()) throw new AppError('No puedes elegir una fecha pasada', 400);
  if (date > addDays(todayStr(), MAX_DAYS_AHEAD)) throw new AppError(`Solo se puede agendar hasta ${MAX_DAYS_AHEAD} días adelante`, 400);
};

const isBooked = (tech, date, time, ignoreAppointmentId = null) =>
  store.appointments.some(
    (a) => a.technicianId === tech.id && a.date === date && a.time === time && OCCUPYING.includes(a.status) && a.id !== ignoreAppointmentId
  );

const isBlocked = (tech, date, startMin) =>
  tech.blocks.some((b) => b.date === date && toMinutes(b.start) < startMin + SLOT_MINUTES && toMinutes(b.end) > startMin);

const getSlots = (tech, date, ignoreAppointmentId = null) => {
  const day = tech.schedule[dayKey(date)];
  if (!day || !day.enabled) return [];
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  const earliest = Date.now() + MIN_LEAD_MINUTES * 60000;
  const slots = [];
  for (let m = open; m + SLOT_MINUTES <= close; m += SLOT_MINUTES) {
    const time = fromMinutes(m);
    const available =
      tech.available &&
      slotStart(date, time).getTime() > earliest &&
      !isBlocked(tech, date, m) &&
      !isBooked(tech, date, time, ignoreAppointmentId);
    slots.push({ time, available });
  }
  return slots;
};

const assertSlotFree = (tech, date, time, ignoreAppointmentId = null) => {
  assertBookableDate(date);
  const slot = getSlots(tech, date, ignoreAppointmentId).find((s) => s.time === time);
  if (!slot) throw new AppError('Esa hora está fuera del horario del técnico', 400);
  if (!slot.available) throw new AppError('Esa franja ya no está disponible', 409);
};

module.exports = { getSlots, assertSlotFree, assertBookableDate, isBooked, SLOT_MINUTES, MAX_DAYS_AHEAD, OCCUPYING };
