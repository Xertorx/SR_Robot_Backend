const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.post('/', authenticate, reviewController.createReview);
router.post('/:id/reply', authenticate, authorize('TECHNICIAN'), reviewController.replyReview);

module.exports = router;
