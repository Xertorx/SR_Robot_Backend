const express = require('express');
const router = express.Router();
const c = require('../controllers/quoteController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const { mediaUpload } = require('../middlewares/upload');

// Rutas de la versión anterior (/quotes/...), conservadas para no romper clientes existentes.
// La referencia vigente es /quote-requests (ver quoteRoutes.js).
router.post('/requests', authenticate, authorize('CLIENT'), mediaUpload.array('media', 8), c.createQuoteRequest);
router.get('/requests/:requestId/quotes', authenticate, authorize('CLIENT', 'ADMIN'), c.getQuotesForRequest);
router.post('/', authenticate, authorize('TECHNICIAN'), c.submitQuote);

module.exports = router;
