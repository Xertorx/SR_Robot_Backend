const store = require('../models/store');
const orderService = require('../services/orderService');
const technicianService = require('../services/technicianService');
const NotificationService = require('../services/notificationService');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields } = require('../utils/validate');

const MAX_TAGS = 5;

// HC-14: reseña auditada; solo el cliente de una orden ENTREGADA y una sola vez
const createReview = asyncHandler(async (req, res) => {
  const orderId = req.params.id || req.body.orderId;
  if (!orderId) throw new AppError('Campo requerido: orderId', 400);
  requireFields(req.body, ['rating']);
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new AppError('rating debe ser un entero entre 1 y 5', 400);

  const order = orderService.findOrder(orderId);
  if (order.clientId !== req.user.id) throw new AppError('Solo el cliente de la orden puede calificarla', 403);
  if (order.state !== 'ENTREGADO') throw new AppError('Solo se pueden publicar reseñas sobre órdenes ENTREGADAS', 400);
  if (store.reviews.some((r) => r.orderId === order.id)) throw new AppError('Esta orden ya fue calificada', 409);

  const tags = Array.isArray(req.body.tags) ? req.body.tags.map(String).slice(0, MAX_TAGS) : [];
  const client = store.users.find((u) => u.id === req.user.id);
  const review = {
    id: store.nextId('reviews'), orderId: order.id, technicianId: order.technicianId, clientId: client.id, clientName: client.name,
    rating, tags, comment: req.body.comment ? String(req.body.comment).slice(0, 1000) : '', hidden: false, reply: null, createdAt: new Date()
  };
  store.reviews.push(review);
  technicianService.recalcRating(order.technicianId);

  NotificationService.notify({
    userId: order.technicianUserId, type: 'REVIEW', title: '⭐ Nueva reseña', body: `Recibiste ${rating} estrellas`, metadata: { reviewId: review.id }
  });
  res.status(201).json({ success: true, message: 'Reseña verificada publicada exitosamente', data: review });
});

// HT-10: una sola respuesta pública por reseña
const replyReview = asyncHandler(async (req, res) => {
  const review = store.reviews.find((r) => r.id === Number(req.params.id));
  if (!review) throw new AppError('Reseña no encontrada', 404);
  const tech = technicianService.getByUserId(req.user.id);
  if (!tech || tech.id !== review.technicianId) throw new AppError('Solo el técnico reseñado puede responder', 403);
  const text = req.body.replyText || req.body.text;
  if (!text || !String(text).trim()) throw new AppError('Campo requerido: replyText', 400);
  if (review.reply) throw new AppError('Esta reseña ya tiene una respuesta', 409);

  review.reply = { text: String(text).trim().slice(0, 1000), repliedAt: new Date() };
  res.status(200).json({ success: true, message: 'Respuesta publicada', data: review });
});

module.exports = { createReview, replyReview };
