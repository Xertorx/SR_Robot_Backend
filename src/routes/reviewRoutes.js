const express = require('express');
const router = express.Router();
const c = require('../controllers/reviewController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

// Versión anterior: POST /reviews con orderId en el cuerpo (la vigente es POST /orders/:id/reviews)
router.post('/', authenticate, authorize('CLIENT'), c.createReview);
router.post('/:id/reply', authenticate, authorize('TECHNICIAN'), c.replyReview);

module.exports = router;
