const express = require('express');
const router = express.Router();
const c = require('../controllers/authController');
const { authenticate } = require('../middlewares/authMiddleware');

router.post('/register', c.register);
router.post('/login', c.login);
router.post('/otp', c.sendOTP);
router.post('/verify', c.verifyOTP);
router.post('/otp/verify', c.verifyOTP); // alias de /verify
router.post('/password/forgot', c.forgotPassword);
router.post('/password/reset', c.resetPassword);
router.post('/refresh', c.refresh);
router.post('/logout', c.logout);

router.get('/me', authenticate, c.me);
router.put('/me', authenticate, c.updateMe);
router.delete('/me', authenticate, c.deleteAccount);
router.get('/me/export', authenticate, c.exportData);
router.post('/switch-mode', authenticate, c.switchMode);
router.get('/consents', authenticate, c.listConsents);
router.post('/consents', authenticate, c.addConsent);

module.exports = router;
