const express = require('express');
const router = express.Router();
const quoteController = require('../controllers/quoteController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.post('/requests', authenticate, quoteController.createQuoteRequest);
router.get('/requests/:requestId/quotes', authenticate, quoteController.getQuotesForRequest);
router.post('/', authenticate, authorize('TECHNICIAN'), quoteController.submitQuote);

module.exports = router;
