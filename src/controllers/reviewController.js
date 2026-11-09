const store = require('../models/store');

const createReview = async (req, res, next) => {
  try {
    const { orderId, rating, comment } = req.body;
    const order = store.orders.find(o => o.id === parseInt(orderId));

    // Regla de reseña auditada: solo se puede calificar si la orden fue completada y entregada
    if (!order || order.state !== 'ENTREGADO') {
      return res.status(400).json({ success: false, message: 'Solo se pueden publicar reseñas sobre órdenes ENTREGADAS' });
    }

    const newReview = {
      id: store.reviews.length + 1,
      orderId: parseInt(orderId),
      technicianId: order.technicianId,
      clientId: req.user ? req.user.id : 1,
      rating: parseInt(rating),
      comment,
      createdAt: new Date()
    };

    store.reviews.push(newReview);
    res.status(201).json({ success: true, message: 'Reseña auditada publicada exitosamente', data: newReview });
  } catch (error) {
    next(error);
  }
};

const replyReview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { replyText } = req.body;
    const review = store.reviews.find(r => r.id === parseInt(id));

    if (!review) return res.status(404).json({ success: false, message: 'Reseña no encontrada' });

    review.reply = {
      text: replyText,
      repliedAt: new Date()
    };

    res.status(200).json({ success: true, message: 'Respuesta del técnico publicada', data: review });
  } catch (error) {
    next(error);
  }
};

module.exports = { createReview, replyReview };
