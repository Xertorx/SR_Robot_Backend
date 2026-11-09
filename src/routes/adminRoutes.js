const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate, authorize('ADMIN'));
router.get('/verifications', adminController.getPendingVerifications);
router.post('/verifications/:id', adminController.verifyTechnician);
router.post('/disputes/resolve', adminController.resolveDispute);
router.get('/metrics', adminController.getPlatformMetrics);

module.exports = router;
