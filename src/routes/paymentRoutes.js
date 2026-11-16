const express = require('express');
const router = express.Router();
const c = require('../controllers/paymentController');
const { authenticate } = require('../middlewares/authMiddleware');

router.post('/webhooks', c.webhook);
router.get('/methods', authenticate, c.listMethods);
router.get('/:reference', authenticate, c.getPayment);

module.exports = router;
