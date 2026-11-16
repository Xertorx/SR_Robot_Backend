const store = require('../models/store');

const log = ({ actorId, action, targetType, targetId = null, details = {} }) => {
  const entry = { id: store.nextId('auditLogs'), actorId, action, targetType, targetId, details, createdAt: new Date() };
  store.auditLogs.push(entry);
  return entry;
};

module.exports = { log };
