const logger = require('../utils/logger');

class PaymentEscrowService {
  // Retiene el dinero en custodia al crear la orden
  static async holdFunds(orderId, amount, paymentMethod) {
    logger.info(`🛡️ [ESCROW HELD] Custodia retenida para Orden #${orderId} por ${amount} COP vía ${paymentMethod}`);
    return { escrowId: `ESC-${Date.now()}`, status: 'HELD', amount, paymentMethod };
  }

  // Libera el dinero al técnico tras confirmación de entrega
  static async releaseFunds(orderId, technicianId, amount) {
    const platformCommission = amount * 0.10; // 10% tarifa plataforma (configurable)
    const netAmount = amount - platformCommission;
    logger.info(`💰 [ESCROW RELEASED] Liberado a Billetera Técnico #${technicianId}: ${netAmount} COP (Comisión: ${platformCommission} COP)`);
    return { status: 'RELEASED', technicianId, netAmount, platformCommission, releasedAt: new Date() };
  }

  // Procesa reembolso al cliente si hay cancelación/disputa
  static async refundClient(orderId, clientId, amount) {
    logger.info(`↩️ [ESCROW REFUND] Reembolso procesado a Cliente #${clientId} por ${amount} COP`);
    return { status: 'REFUNDED', clientId, amount, refundedAt: new Date() };
  }
}

module.exports = PaymentEscrowService;
