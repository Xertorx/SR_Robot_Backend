const store = require('../models/store');

const getSpareParts = async (req, res, next) => {
  try {
    const { category } = req.query;
    let result = store.spareParts;
    if (category) result = result.filter(p => p.category.toLowerCase() === category.toLowerCase());
    res.status(200).json({ success: true, count: result.length, data: result });
  } catch (error) {
    next(error);
  }
};

const createOrder = async (req, res, next) => {
  try {
    const { items, shippingAddress } = req.body;
    const total = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
    const order = {
      id: Date.now(),
      items,
      total,
      shippingAddress,
      status: 'PROCESSING',
      createdAt: new Date()
    };
    res.status(201).json({ success: true, message: 'Pedido de repuestos creado exitosamente', data: order });
  } catch (error) {
    next(error);
  }
};

module.exports = { getSpareParts, createOrder };
