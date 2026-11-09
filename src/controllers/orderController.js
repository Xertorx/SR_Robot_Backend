const store = require('../models/store');
const { ORDER_STATES, ALLOWED_TRANSITIONS } = require('../constants/orderStates');
const PaymentEscrowService = require('../services/paymentEscrowService');
const NotificationService = require('../services/notificationService');

const createOrder = async (req, res, next) => {
  try {
    const { technicianId, serviceName, amount, isHomeService, paymentMethod } = req.body;

    const escrow = await PaymentEscrowService.holdFunds(Date.now(), amount, paymentMethod);

    const newOrder = {
      id: store.orders.length + 1,
      clientId: req.user ? req.user.id : 1,
      technicianId: parseInt(technicianId),
      serviceName,
      amount: parseFloat(amount),
      isHomeService,
      paymentMethod,
      state: ORDER_STATES.SOLICITADO,
      escrowStatus: escrow.status,
      history: [{ state: ORDER_STATES.SOLICITADO, timestamp: new Date(), note: 'Orden creada y pago en custodia' }],
      createdAt: new Date()
    };

    store.orders.push(newOrder);

    res.status(201).json({ success: true, message: 'Orden creada exitosamente y pago retenido en custodia', data: newOrder });
  } catch (error) {
    next(error);
  }
};

const getOrders = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, count: store.orders.length, data: store.orders });
  } catch (error) {
    next(error);
  }
};

const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = store.orders.find(o => o.id === parseInt(id));
    if (!order) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
    res.status(200).json({ success: true, data: order });
  } catch (error) {
    next(error);
  }
};

const transitionOrderState = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newState, note } = req.body;
    const order = store.orders.find(o => o.id === parseInt(id));

    if (!order) return res.status(404).json({ success: false, message: 'Orden no encontrada' });

    const allowed = ALLOWED_TRANSITIONS[order.state];
    if (!allowed || !allowed.includes(newState)) {
      return res.status(400).json({
        success: false,
        message: `Transición inválida de ${order.state} hacia ${newState}. Transiciones permitidas: ${allowed.join(', ')}`
      });
    }

    order.state = newState;
    order.history.push({ state: newState, timestamp: new Date(), note: note || `Estado actualizado a ${newState}` });

    await NotificationService.sendNotification({
      userId: order.clientId,
      title: `📦 Actualización de Orden #${order.id}`,
      body: `Tu orden ahora está en estado: ${newState}`
    });

    res.status(200).json({ success: true, message: `Estado actualizado a ${newState}`, data: order });
  } catch (error) {
    next(error);
  }
};

const confirmReceiptAndReleasePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = store.orders.find(o => o.id === parseInt(id));

    if (!order) return res.status(404).json({ success: false, message: 'Orden no encontrada' });
    if (order.state !== ORDER_STATES.LISTO) {
      return res.status(400).json({ success: false, message: 'La orden debe estar en estado LISTO para confirmar recepción' });
    }

    order.state = ORDER_STATES.ENTREGADO;
    order.history.push({ state: ORDER_STATES.ENTREGADO, timestamp: new Date(), note: 'Cliente confirmó recepción exitosa' });

    // Liberar fondos retenidos en custodia al técnico
    const releaseResult = await PaymentEscrowService.releaseFunds(order.id, order.technicianId, order.amount);
    order.escrowStatus = releaseResult.status;

    res.status(200).json({
      success: true,
      message: 'Recepción confirmada. Pago liberado al técnico y garantía de 90 días activada.',
      data: { order, releaseResult }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { createOrder, getOrders, getOrderById, transitionOrderState, confirmReceiptAndReleasePayment };
