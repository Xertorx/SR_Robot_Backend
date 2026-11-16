const jwt = require('jsonwebtoken');
const config = require('../config/env');
const store = require('../models/store');

const readToken = (req) => {
  const header = req.headers.authorization;
  return header && header.startsWith('Bearer ') ? header.split(' ')[1] : null;
};

// Devuelve el usuario autenticado o lanza un error de auth; el rol activo viene del token (modo cliente/técnico)
const resolveUser = (token) => {
  const decoded = jwt.verify(token, config.jwtSecret);
  const user = store.users.find((u) => u.id === decoded.id);
  if (!user || user.deletedAt) throw new Error('Usuario no disponible');
  const role = user.roles.includes(decoded.role) ? decoded.role : user.role;
  return { id: user.id, email: user.email, role, roles: user.roles, country: user.country };
};

const authenticate = (req, res, next) => {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado: token no proporcionado' });
  }
  try {
    req.user = resolveUser(token);
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
};

// Para rutas públicas que pueden personalizar la respuesta si hay sesión
const optionalAuth = (req, res, next) => {
  const token = readToken(req);
  if (token) {
    try {
      req.user = resolveUser(token);
    } catch (error) {
      req.user = null;
    }
  }
  next();
};

const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Acceso prohibido: privilegios insuficientes' });
  }
  next();
};

module.exports = { authenticate, optionalAuth, authorize, resolveUser };
