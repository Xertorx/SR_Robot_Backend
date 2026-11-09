const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const technicianRoutes = require('./technicianRoutes');
const quoteRoutes = require('./quoteRoutes');
const orderRoutes = require('./orderRoutes');
const chatRoutes = require('./chatRoutes');
const reviewRoutes = require('./reviewRoutes');
const supplierRoutes = require('./supplierRoutes');
const adminRoutes = require('./adminRoutes');

router.use('/auth', authRoutes);
router.use('/technicians', technicianRoutes);
router.use('/quotes', quoteRoutes);
router.use('/orders', orderRoutes);
router.use('/chat', chatRoutes);
router.use('/reviews', reviewRoutes);
router.use('/supplier', supplierRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
