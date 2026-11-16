const express = require('express');
const router = express.Router();
const c = require('../controllers/disputeController');
const { authenticate } = require('../middlewares/authMiddleware');

router.use(authenticate);
router.post('/', c.createReport);
router.get('/mine', c.listMyReports);

module.exports = router;
