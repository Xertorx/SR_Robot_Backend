const ROLES = {
  CLIENT: 'CLIENT',
  TECHNICIAN: 'TECHNICIAN',
  SUPPLIER: 'SUPPLIER',
  ADMIN: 'ADMIN'
};

const PLANS = {
  BASIC: { name: 'Básico', price: 0, maxQuotes: 10 },
  PRO: { name: 'Pro', price: 49900, maxQuotes: 100, discountSpareParts: 0.10 },
  PREMIUM: { name: 'Premium', price: 99900, maxQuotes: -1, discountSpareParts: 0.15, multiUser: true }
};

module.exports = { ROLES, PLANS };
