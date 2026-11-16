// Almacenamiento en memoria. Todo el dominio vive aquí para poder pasar luego a una BD real sin tocar controladores.
const counters = {};

const store = {
  users: [],
  sessions: [],
  otps: [],
  technicians: [],
  quoteRequests: [],
  quotes: [],
  appointments: [],
  orders: [],
  conversations: [],
  messages: [],
  notifications: [],
  reviews: [],
  reports: [],
  disputes: [],
  payments: [],
  ledger: [],
  withdrawals: [],
  subscriptions: [],
  invoices: [],
  spareParts: [],
  supplierOrders: [],
  equipments: [],
  addresses: [],
  paymentMethods: [],
  favorites: [],
  profileViews: [],
  auditLogs: [],
  countries: {},
  settings: {}
};

store.nextId = (name) => {
  counters[name] = (counters[name] || 0) + 1;
  return counters[name];
};

module.exports = store;
