const express = require('express');
const router = express.Router();
const c = require('../controllers/adminController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate, authorize('ADMIN'));

router.get('/verifications', c.getPendingVerifications);
router.get('/verifications/:id', c.getVerification);
router.get('/verifications/:id/documents/:docId', c.downloadDocument);
router.post('/verifications/:id', c.verifyTechnician);

router.get('/disputes', c.listDisputes);
router.post('/disputes/resolve', c.resolveDispute); // versión anterior: { orderId, decision }
router.get('/disputes/:id', c.getDispute);
router.post('/disputes/:id/resolve', c.resolveDispute);

router.get('/reviews', c.listReviews);
router.post('/reviews/:id/hide', c.hideReview);
router.post('/reviews/:id/restore', c.restoreReview);
router.get('/reports', c.listReports);
router.post('/reports/:id/resolve', c.resolveReport);

router.get('/config', c.getConfig);
router.put('/config', c.updateConfig);
router.post('/countries', c.createCountry);
router.put('/countries/:code', c.updateCountry);
router.get('/suppliers', c.listSuppliers);
router.post('/suppliers/:id/status', c.setSupplierCatalogStatus);

router.get('/metrics', c.getPlatformMetrics);
router.get('/audit', c.getAuditLog);

module.exports = router;
