const express = require('express');
const router = express.Router();
const supplierController = require('../controllers/supplierController');

router.get('/products', supplierController.getSpareParts);
router.post('/orders', supplierController.createOrder);

module.exports = router;
