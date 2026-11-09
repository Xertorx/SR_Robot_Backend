const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/otp', authController.sendOTP);
router.post('/otp/verify', authController.verifyOTP);

module.exports = router;
