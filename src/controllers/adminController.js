const store = require('../models/store');
const PaymentEscrowService = require('../services/paymentEscrowService');

const getPendingVerifications = async (req, res, next) => {
  try {
    const pending = store.technicians.filter(t => t.verificationStatus === 'PENDING');
    res.status(200).json({ success: true, count: pending.length, data: pending });
  } catch (error) {
    next(error);
  }
};

const verifyTechnician = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, note } = req.body; // 'VERIFIED' | 'REJECTED'
    const tech = store.technicians.find(t => t.id === parseInt(id));

    if (!tech) return res.status(404).json({ success: false, message: 'Técnico no encontrado' });

    tech.verificationStatus = status;
    tech.isVerified = (status === 'VERIFIED');

    res.status(200).json({ success: true, message: `Verificación de técnico actualizada a: ${status}`, data: tech });
  } catch (error) {
    next(error);
  }
};

const resolveDispute = async (req, res, next) => {
  try {
    const { orderId, decision } = req.body; // decision: 'REFUND_CLIENT' | 'RELEASE_TECHNICIAN'
    const order = store.orders.find(o => o.id === parseInt(orderId));

    if (!order) return res.status(404).json({ success: false, message: 'Orden no encontrada' });

    if (decision === 'REFUND_CLIENT') {
      await PaymentEscrowService.refundClient(order.id, order.clientId, order.amount);
      order.state = 'CANCELADO';
    } else {
      await PaymentEscrowService.releaseFunds(order.id, order.technicianId, order.amount);
      order.state = 'ENTREGADO';
    }

    res.status(200).json({ success: true, message: `Disputa resuelta mediante ${decision}`, data: order });
  } catch (error) {
    next(error);
  }
};

const getPlatformMetrics = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        totalUsers: store.users.length,
        activeTechnicians: store.technicians.length,
        totalOrders: store.orders.length,
        mrr: 499000,
        escrowHeldAmount: 180000
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPendingVerifications, verifyTechnician, resolveDispute, getPlatformMetrics };
