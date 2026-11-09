const store = require('../models/store');
const NotificationService = require('../services/notificationService');

const createQuoteRequest = async (req, res, next) => {
  try {
    const { deviceType, brandModel, issueDescription, isHomeService, targetTechnicianId } = req.body;

    const newRequest = {
      id: store.quoteRequests.length + 1,
      clientId: req.user ? req.user.id : 1,
      deviceType,
      brandModel,
      issueDescription,
      isHomeService: isHomeService || false,
      targetTechnicianId: targetTechnicianId ? parseInt(targetTechnicianId) : null,
      status: 'OPEN',
      createdAt: new Date()
    };

    store.quoteRequests.push(newRequest);

    // Notificar a técnicos cercanos
    await NotificationService.sendNotification({
      userId: targetTechnicianId || 2,
      title: '🔨 Nueva solicitud de cotización',
      body: `Equipo: ${brandModel} - Falla: ${issueDescription}`
    });

    res.status(201).json({ success: true, message: 'Solicitud de cotización enviada', data: newRequest });
  } catch (error) {
    next(error);
  }
};

const getQuotesForRequest = async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const quotes = store.quotes.filter(q => q.requestId === parseInt(requestId));
    res.status(200).json({ success: true, count: quotes.length, data: quotes });
  } catch (error) {
    next(error);
  }
};

const submitQuote = async (req, res, next) => {
  try {
    const { requestId, price, estimatedTime, warrantyDays, message } = req.body;
    const tech = store.technicians.find(t => t.userId === req.user.id);

    const newQuote = {
      id: store.quotes.length + 1,
      requestId: parseInt(requestId),
      technicianId: tech ? tech.id : 1,
      technicianName: tech ? tech.businessName : 'Técnico Especialista',
      price: parseFloat(price),
      estimatedTime,
      warrantyDays: warrantyDays || 90,
      message,
      createdAt: new Date()
    };

    store.quotes.push(newQuote);

    // Notificar al cliente
    await NotificationService.sendNotification({
      userId: 1,
      title: '📩 Cotización recibida',
      body: `${newQuote.technicianName} te ha cotizado por $${price} COP`
    });

    res.status(201).json({ success: true, message: 'Cotización enviada exitosamente', data: newQuote });
  } catch (error) {
    next(error);
  }
};

module.exports = { createQuoteRequest, getQuotesForRequest, submitQuote };
