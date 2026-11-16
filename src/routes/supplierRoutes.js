const express = require('express');
const router = express.Router();
const c = require('../controllers/supplierController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate);
router.get('/products', authorize('TECHNICIAN', 'SUPPLIER', 'ADMIN'), c.getSpareParts);
router.post('/products', authorize('SUPPLIER'), c.createProduct);
router.put('/products/:id', authorize('SUPPLIER'), c.updateProduct);
router.delete('/products/:id', authorize('SUPPLIER'), c.deleteProduct);
router.get('/orders', authorize('TECHNICIAN', 'SUPPLIER', 'ADMIN'), c.listOrders);
router.post('/orders', authorize('TECHNICIAN'), c.createOrder);
router.patch('/orders/:id/status', authorize('SUPPLIER'), c.updateOrderStatus);

module.exports = router;
