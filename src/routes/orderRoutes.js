const express = require('express');
const router = express.Router();
const c = require('../controllers/orderController');
const reviews = require('../controllers/reviewController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const { mediaUpload } = require('../middlewares/upload');

const participant = authorize('CLIENT', 'TECHNICIAN', 'ADMIN');

router.use(authenticate);
router.post('/', authorize('CLIENT'), c.createOrder);
router.get('/', participant, c.getOrders);
router.get('/:id', participant, c.getOrderById);
router.post('/:id/transitions', participant, c.transitionOrderState);
router.post('/:id/confirm-receipt', authorize('CLIENT'), c.confirmReceiptAndReleasePayment);
router.post('/:id/cancel', participant, c.cancelOrder);
router.post('/:id/evidence', authorize('TECHNICIAN'), mediaUpload.array('media', 8), c.addEvidence);
router.post('/:id/adjustments', authorize('TECHNICIAN'), c.requestAdjustment);
router.post('/:id/adjustments/:adjustmentId/approve', authorize('CLIENT'), c.approveAdjustment);
router.post('/:id/adjustments/:adjustmentId/reject', authorize('CLIENT'), c.rejectAdjustment);
router.post('/:id/reviews', authorize('CLIENT'), reviews.createReview);
router.post('/:id/disputes', participant, mediaUpload.array('media', 8), c.openDispute);

module.exports = router;
