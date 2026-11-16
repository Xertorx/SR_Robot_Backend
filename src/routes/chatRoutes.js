const express = require('express');
const router = express.Router();
const c = require('../controllers/chatController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');
const { mediaUpload } = require('../middlewares/upload');

// El tiempo real va por WebSocket en /chat/{conversationId}?token=... (ver services/realtime.js)
router.use(authenticate, authorize('CLIENT', 'TECHNICIAN'));
router.get('/conversations', c.getConversations);
router.post('/conversations', c.createConversation);
router.get('/conversations/:conversationId/messages', c.getMessages);
router.post('/conversations/:conversationId/messages', mediaUpload.array('attachments', 3), c.sendMessage);
router.post('/conversations/:conversationId/read', c.markRead);

module.exports = router;
