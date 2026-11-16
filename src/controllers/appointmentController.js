const store = require('../models/store');
const orderService = require('../services/orderService');
const availabilityService = require('../services/availabilityService');
const technicianService = require('../services/technicianService');
const paymentService = require('../services/paymentService');
const NotificationService = require('../services/notificationService');
const { calculateDistanceKm } = require('../utils/geoUtils');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, toInt, paginate } = require('../utils/validate');
const { isValidDate, isValidTime, slotStart, addHours } = require('../utils/dates');

const RESCHEDULE_MIN_HOURS = 2;

const findAppointment = (id) => {
  const appointment = store.appointments.find((a) => a.id === Number(id));
  if (!appointment) throw new AppError('Cita no encontrada', 404);
  return appointment;
};

const assertParticipant = (appointment, user) => {
  if (user.role === 'ADMIN' || appointment.clientId === user.id || appointment.technicianUserId === user.id) return;
  throw new AppError('No tienes acceso a esta cita', 403);
};

// HC-09 / HC-10: reserva sin choques, total estimado y pago retenido
const createAppointment = asyncHandler(async (req, res) => {
  requireFields(req.body, ['technicianId', 'serviceId', 'date', 'time', 'paymentMethod']);
  const { date, time, paymentMethod, addressId, notes = '', equipmentId = null } = req.body;
  const mode = req.body.mode || 'LOCAL';
  if (!['LOCAL', 'HOME'].includes(mode)) throw new AppError('mode debe ser LOCAL o HOME', 400);
  if (!isValidDate(date) || !isValidTime(time)) throw new AppError('Fecha u hora inválida (YYYY-MM-DD, HH:MM)', 400);

  const tech = technicianService.getById(toInt(req.body.technicianId, 'technicianId'));
  if (!tech || !technicianService.isListed(tech)) throw new AppError('Técnico no encontrado', 404);
  if (!tech.isVerified) throw new AppError('Este negocio aún no está verificado', 409);
  const service = tech.services.find((s) => s.id === Number(req.body.serviceId) && s.active);
  if (!service) throw new AppError('Servicio no disponible', 404);

  const client = store.users.find((u) => u.id === req.user.id);
  let address = null;
  let homeFee = 0;
  if (mode === 'HOME') {
    if (!tech.homeService) throw new AppError('Este técnico no atiende a domicilio', 400);
    const saved = addressId ? store.addresses.find((a) => a.id === Number(addressId) && a.userId === client.id) : null;
    if (addressId && !saved) throw new AppError('Dirección no encontrada', 404);
    address = saved ? saved.address : req.body.address;
    if (!address) throw new AppError('Indica la dirección para el servicio a domicilio', 400);
    if (saved && saved.lat !== null && saved.lng !== null) {
      const distance = calculateDistanceKm(saved.lat, saved.lng, tech.location.lat, tech.location.lng);
      if (distance !== null && distance > tech.coverageRadiusKm) {
        throw new AppError(`La dirección está fuera de la cobertura del técnico (${tech.coverageRadiusKm} km)`, 400);
      }
    }
    homeFee = tech.homeExtraFee;
  }

  paymentService.assertMethod(client, paymentMethod);
  availabilityService.assertSlotFree(tech, date, time);

  const appointment = {
    id: store.nextId('appointments'), clientId: client.id, technicianId: tech.id, technicianUserId: tech.userId,
    serviceId: service.id, serviceName: service.name, date, time, mode, address, notes, status: 'CONFIRMED',
    orderId: null, total: service.priceFrom + homeFee, homeFee, reminderSent: false, createdAt: new Date()
  };
  store.appointments.push(appointment);

  try {
    const { order, payment } = orderService.create({
      client, tech, serviceName: service.name, amount: service.priceFrom, homeFee, isHomeService: mode === 'HOME', paymentMethod,
      address, equipmentId, warrantyDays: service.warrantyDays, source: 'APPOINTMENT', appointmentId: appointment.id,
      estimatedHours: service.estimatedHours, estimatedDelivery: service.estimatedHours ? addHours(slotStart(date, time), service.estimatedHours) : null
    });
    appointment.orderId = order.id;
    NotificationService.notify({
      userId: tech.userId, type: 'APPOINTMENT', title: '📅 Nueva cita', body: `${service.name} el ${date} a las ${time}`,
      metadata: { appointmentId: appointment.id }
    });
    res.status(201).json({
      success: true, message: 'Cita confirmada',
      data: {
        appointment,
        order: orderService.serialize(order),
        payment,
        summary: { service: service.priceFrom, homeFee, total: appointment.total, currency: order.currency }
      }
    });
  } catch (error) {
    // Si no se pudo crear la orden, la franja no debe quedar bloqueada
    appointment.status = 'CANCELLED';
    throw error;
  }
});

const listAppointments = asyncHandler(async (req, res) => {
  const { date, from, to, status } = req.query;
  let list = store.appointments.filter((a) =>
    req.user.role === 'ADMIN' ||
    (req.user.role === 'TECHNICIAN' ? a.technicianUserId === req.user.id : a.clientId === req.user.id)
  );
  if (date) list = list.filter((a) => a.date === date);
  if (from) list = list.filter((a) => a.date >= from);
  if (to) list = list.filter((a) => a.date <= to);
  if (status) list = list.filter((a) => a.status === String(status).toUpperCase());
  list.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const { items, meta } = paginate(list, { limit: 100, ...req.query });
  res.status(200).json({ success: true, meta, data: items });
});

const getAppointment = asyncHandler(async (req, res) => {
  const appointment = findAppointment(req.params.id);
  assertParticipant(appointment, req.user);
  res.status(200).json({ success: true, data: appointment });
});

// HC-17: cancelar aplica la política de reembolso de la orden
const cancelAppointment = asyncHandler(async (req, res) => {
  const appointment = findAppointment(req.params.id);
  assertParticipant(appointment, req.user);
  if (appointment.status !== 'CONFIRMED') throw new AppError(`La cita está ${appointment.status}`, 409);
  const order = orderService.findOrder(appointment.orderId);
  const refund = orderService.cancel(order, req.user, req.body.reason);
  res.status(200).json({ success: true, message: 'Cita cancelada', data: { appointment, refund } });
});

const rescheduleAppointment = asyncHandler(async (req, res) => {
  const appointment = findAppointment(req.params.id);
  assertParticipant(appointment, req.user);
  requireFields(req.body, ['date', 'time']);
  const { date, time } = req.body;
  if (appointment.status !== 'CONFIRMED') throw new AppError(`La cita está ${appointment.status}`, 409);
  if (!isValidDate(date) || !isValidTime(time)) throw new AppError('Fecha u hora inválida (YYYY-MM-DD, HH:MM)', 400);
  const order = orderService.findOrder(appointment.orderId);
  if (order.state !== 'SOLICITADO') throw new AppError('Solo se puede reprogramar antes de iniciar el servicio', 409);
  if (slotStart(appointment.date, appointment.time).getTime() - Date.now() < RESCHEDULE_MIN_HOURS * 3600000) {
    throw new AppError(`Solo puedes reprogramar con al menos ${RESCHEDULE_MIN_HOURS} horas de anticipación`, 409);
  }

  const tech = technicianService.getById(appointment.technicianId);
  availabilityService.assertSlotFree(tech, date, time, appointment.id);
  const previous = { date: appointment.date, time: appointment.time };
  Object.assign(appointment, { date, time, reminderSent: false });
  orderService.addHistory(order, { state: order.state, note: `Cita reprogramada de ${previous.date} ${previous.time} a ${date} ${time}`, actorId: req.user.id });

  const otherId = req.user.id === appointment.clientId ? appointment.technicianUserId : appointment.clientId;
  NotificationService.notify({ userId: otherId, type: 'APPOINTMENT', title: '🔁 Cita reprogramada', body: `Nueva fecha: ${date} a las ${time}`, metadata: { appointmentId: appointment.id } });
  res.status(200).json({ success: true, message: 'Cita reprogramada', data: appointment });
});

module.exports = { createAppointment, listAppointments, getAppointment, cancelAppointment, rescheduleAppointment };
