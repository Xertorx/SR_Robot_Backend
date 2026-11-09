const express = require('express');
const router = express.Router();
const techController = require('../controllers/technicianController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.get('/', techController.getTechnicians);
router.get('/:id', techController.getTechnicianById);
router.get('/:id/availability', techController.getAvailability);
router.post('/me/services', authenticate, authorize('TECHNICIAN'), techController.addService);
router.get('/me/wallet', authenticate, authorize('TECHNICIAN'), techController.getWallet);
router.get('/me/analytics', authenticate, authorize('TECHNICIAN'), techController.getAnalytics);

module.exports = router;
