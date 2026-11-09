const store = require('../models/store');

const getConversations = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: store.chatConversations });
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const messages = store.chatMessages.filter(m => m.conversationId === parseInt(conversationId));
    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { text, attachmentUrl } = req.body;

    const newMessage = {
      id: Date.now(),
      conversationId: parseInt(conversationId),
      senderId: req.user ? req.user.id : 1,
      text,
      attachmentUrl: attachmentUrl || null,
      timestamp: new Date()
    };

    store.chatMessages.push(newMessage);
    res.status(201).json({ success: true, data: newMessage });
  } catch (error) {
    next(error);
  }
};

module.exports = { getConversations, getMessages, sendMessage };
