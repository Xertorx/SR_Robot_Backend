const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { authenticate } = require('../middlewares/authMiddleware');

router.post('/', authenticate, orderController.createOrder);
router.get('/', authenticate, orderController.getOrders);
router.get('/:id', authenticate, orderController.getOrderById);
router.post('/:id/transitions', authenticate, orderController.transitionOrderState);
router.post('/:id/confirm-receipt', authenticate, orderController.confirmReceiptAndReleasePayment);

module.exports = router;
