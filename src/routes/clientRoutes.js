const express = require('express');
const router = express.Router();
const c = require('../controllers/clientController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate, authorize('CLIENT'));

router.get('/addresses', c.listAddresses);
router.post('/addresses', c.createAddress);
router.put('/addresses/:id', c.updateAddress);
router.delete('/addresses/:id', c.deleteAddress);

router.get('/equipments', c.listEquipments);
router.post('/equipments', c.createEquipment);
router.put('/equipments/:id', c.updateEquipment);
router.delete('/equipments/:id', c.deleteEquipment);
router.get('/warranties', c.listWarranties);

router.get('/payment-methods', c.listPaymentMethods);
router.post('/payment-methods', c.createPaymentMethod);
router.put('/payment-methods/:id', c.updatePaymentMethod);
router.delete('/payment-methods/:id', c.deletePaymentMethod);

router.get('/favorites', c.listFavorites);
router.post('/favorites/:technicianId', c.addFavorite);
router.delete('/favorites/:technicianId', c.removeFavorite);

module.exports = router;
