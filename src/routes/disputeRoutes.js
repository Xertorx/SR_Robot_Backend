const express = require('express');
const router = express.Router();
const c = require('../controllers/disputeController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const { mediaUpload } = require('../middlewares/upload');

router.use(authenticate, authorize('CLIENT', 'TECHNICIAN', 'ADMIN'));
router.get('/', c.listMine);
router.get('/:id', c.getOne);
router.post('/:id/comments', mediaUpload.array('media', 8), c.addComment);

module.exports = router;
