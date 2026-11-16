const express = require('express');
const router = express.Router();
const c = require('../controllers/quoteController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const { mediaUpload } = require('../middlewares/upload');

const client = [authenticate, authorize('CLIENT')];
const tech = [authenticate, authorize('TECHNICIAN')];

router.post('/', ...client, mediaUpload.array('media', 8), c.createQuoteRequest);
router.get('/mine', ...client, c.getMyRequests);
router.get('/received', ...tech, c.getReceivedRequests);
router.get('/:requestId', authenticate, c.getRequest);
router.post('/:requestId/cancel', ...client, c.cancelRequest);
router.get('/:requestId/quotes', authenticate, authorize('CLIENT', 'ADMIN'), c.getQuotesForRequest);
router.post('/:requestId/quotes', ...tech, c.submitQuote);
router.post('/:requestId/reject', ...tech, c.rejectRequest);
router.post('/:requestId/quotes/:quoteId/accept', ...client, c.acceptQuote);

module.exports = router;
