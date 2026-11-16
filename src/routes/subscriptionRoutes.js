const express = require('express');
const router = express.Router();
const c = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

const tech = [authenticate, authorize('TECHNICIAN')];

router.get('/plans', c.listPlans);
router.get('/me', ...tech, c.getMySubscription);
router.put('/me', ...tech, c.subscribe);
router.delete('/me', ...tech, c.cancelSubscription);
router.get('/invoices', ...tech, c.listInvoices);
router.post('/', ...tech, c.subscribe);

module.exports = router;
