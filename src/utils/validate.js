const { AppError } = require('./errors');

const requireFields = (obj, fields) => {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null || obj[f] === '');
  if (missing.length) throw new AppError(`Campos requeridos: ${missing.join(', ')}`, 400);
};

const toInt = (value, name = 'id') => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new AppError(`${name} inválido`, 400);
  return n;
};

const toPositiveInt = (value, name = 'monto') => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`${name} debe ser un entero positivo`, 400);
  return n;
};

const parseBool = (v) => v === true || v === 'true' || v === '1' || v === 1;

const toNumberOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normalizeEmail = (email) => (typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null);

const normalizePhone = (phone) => {
  if (typeof phone !== 'string' || !phone.trim()) return null;
  const cleaned = phone.replace(/[\s()-]/g, '');
  return /^\+?\d{7,15}$/.test(cleaned) ? cleaned : null;
};

const isEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const paginate = (items, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  return {
    items: items.slice((page - 1) * limit, page * limit),
    meta: { total, page, limit, pages }
  };
};

module.exports = {
  requireFields,
  toInt,
  toPositiveInt,
  parseBool,
  toNumberOrNull,
  normalizeEmail,
  normalizePhone,
  isEmail,
  stripAccents,
  paginate
};
