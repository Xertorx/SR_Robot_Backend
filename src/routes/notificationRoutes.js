const express = require('express');
const router = express.Router();
const c = require('../controllers/notificationController');
const { authenticate } = require('../middlewares/authMiddleware');

router.use(authenticate);
router.get('/', c.list);
router.post('/read-all', c.markAllRead);
router.get('/preferences', c.getPreferences);
router.put('/preferences', c.updatePreferences);
router.patch('/:id/read', c.markRead);
router.post('/:id/read', c.markRead);

module.exports = router;
