const express = require('express');
const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/technicians', require('./technicianRoutes'));
router.use('/quote-requests', require('./quoteRoutes'));
router.use('/quotes', require('./legacyQuoteRoutes'));
router.use('/appointments', require('./appointmentRoutes'));
router.use('/orders', require('./orderRoutes'));
router.use('/chat', require('./chatRoutes'));
router.use('/reviews', require('./reviewRoutes'));
router.use('/notifications', require('./notificationRoutes'));
router.use('/client', require('./clientRoutes'));
router.use('/payments', require('./paymentRoutes'));
router.use('/subscriptions', require('./subscriptionRoutes'));
router.use('/supplier', require('./supplierRoutes'));
router.use('/disputes', require('./disputeRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/admin', require('./adminRoutes'));
router.use('/config', require('./configRoutes'));

module.exports = router;
