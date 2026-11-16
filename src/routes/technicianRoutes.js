const express = require('express');
const router = express.Router();
const c = require('../controllers/technicianController');
const { authenticate, optionalAuth, authorize } = require('../middlewares/authMiddleware');
const { documentUpload } = require('../middlewares/upload');

const tech = [authenticate, authorize('TECHNICIAN')];

router.get('/', c.getTechnicians);

// Rutas /me antes que /:id para que "me" no se interprete como un identificador
router.get('/me', ...tech, c.getMyProfile);
router.put('/me', ...tech, c.updateMyProfile);
router.get('/me/schedule', ...tech, c.getSchedule);
router.put('/me/schedule', ...tech, c.updateSchedule);
router.post('/me/blocks', ...tech, c.addBlock);
router.delete('/me/blocks/:blockId', ...tech, c.removeBlock);
router.get('/me/services', ...tech, c.listMyServices);
router.post('/me/services', ...tech, c.addService);
router.put('/me/services/:serviceId', ...tech, c.updateService);
router.delete('/me/services/:serviceId', ...tech, c.deleteService);
router.post('/me/documents', ...tech, documentUpload.array('documents', 5), c.uploadDocuments);
router.post('/me/submit-verification', ...tech, c.submitVerification);
router.get('/me/wallet', ...tech, c.getWallet);
router.get('/me/ledger', ...tech, c.getLedger);
router.get('/me/withdrawals', ...tech, c.listWithdrawals);
router.post('/me/withdrawals', ...tech, c.createWithdrawal);
router.get('/me/analytics', ...tech, c.getAnalytics);

router.get('/:id', optionalAuth, c.getTechnicianById);
router.get('/:id/availability', c.getAvailability);
router.get('/:id/reviews', c.getReviews);

module.exports = router;
