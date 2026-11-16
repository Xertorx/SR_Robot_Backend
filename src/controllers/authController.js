const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../config/env');
const store = require('../models/store');
const NotificationService = require('../services/notificationService');
const technicianService = require('../services/technicianService');
const { SELF_REGISTER_ROLES } = require('../constants/roles');
const { ACTIVE_STATES } = require('../constants/orderStates');
const { AppError, asyncHandler } = require('../utils/errors');
const { requireFields, normalizeEmail, normalizePhone, isEmail } = require('../utils/validate');
const { addDaysToDate } = require('../utils/dates');

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const publicUser = (user) => {
  const { passwordHash, ...rest } = user;
  return rest;
};

const issueTokens = (user, role) => {
  const token = jwt.sign({ id: user.id, email: user.email, role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  const refreshToken = crypto.randomBytes(40).toString('hex');
  store.sessions.push({
    id: store.nextId('sessions'), userId: user.id, role, refreshHash: sha256(refreshToken),
    expiresAt: addDaysToDate(new Date(), config.refreshTokenDays), revokedAt: null, createdAt: new Date()
  });
  return { user: publicUser(user), token, refreshToken };
};

const revokeSessions = (userId) =>
  store.sessions.filter((s) => s.userId === userId && !s.revokedAt).forEach((s) => { s.revokedAt = new Date(); });

const findByIdentifier = ({ email, phone }) => {
  const e = normalizeEmail(email);
  const p = normalizePhone(phone);
  if (!e && !p) throw new AppError('Indica email o phone', 400);
  const identifier = e || p;
  const user = store.users.find((u) => !u.deletedAt && (e ? u.email === e : u.phone === p));
  return { user, identifier };
};

const register = asyncHandler(async (req, res) => {
  const { name, password, role = 'CLIENT', acceptTerms, country, locale } = req.body;
  requireFields(req.body, ['name', 'password']);
  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);
  if (!email && !phone) throw new AppError('Debes indicar un correo o un celular válidos', 400);
  if (email && !isEmail(email)) throw new AppError('Correo inválido', 400);
  if (req.body.phone && !phone) throw new AppError('Celular inválido', 400);
  if (String(password).length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres', 400);
  if (!SELF_REGISTER_ROLES.includes(role)) throw new AppError(`Rol inválido. Opciones: ${SELF_REGISTER_ROLES.join(', ')}`, 400);
  if (acceptTerms !== true && acceptTerms !== 'true') {
    throw new AppError('Debes aceptar los términos y la política de tratamiento de datos', 400);
  }
  const countryCode = country && store.countries[country] ? country : config.countryCode;
  if (store.users.some((u) => !u.deletedAt && ((email && u.email === email) || (phone && u.phone === phone)))) {
    throw new AppError('El correo o celular ya se encuentra registrado', 409);
  }

  const user = {
    id: store.nextId('users'), name: String(name).trim(), email, phone, passwordHash: await bcrypt.hash(String(password), 10),
    roles: [role], role, country: countryCode, locale: locale || store.countries[countryCode].locale,
    emailVerified: false, phoneVerified: false,
    consents: [{ type: 'TERMS_AND_PRIVACY', version: '1.0', acceptedAt: new Date(), ip: req.ip }],
    preferences: { push: true, email: true, whatsapp: false }, createdAt: new Date(), deletedAt: null
  };
  store.users.push(user);
  if (role === 'TECHNICIAN') technicianService.createProfile(user, req.body);

  res.status(201).json({ success: true, message: 'Usuario registrado exitosamente', data: issueTokens(user, role) });
});

const login = asyncHandler(async (req, res) => {
  const { password, role } = req.body;
  requireFields(req.body, ['password']);
  const { user } = findByIdentifier(req.body);
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    throw new AppError('Credenciales inválidas', 401);
  }
  const mode = role && user.roles.includes(role) ? role : user.role;
  res.status(200).json({ success: true, message: 'Inicio de sesión exitoso', data: issueTokens(user, mode) });
});

// HC-01: OTP de 6 dígitos por celular o correo
const sendOTP = asyncHandler(async (req, res) => {
  const purpose = ['LOGIN', 'VERIFY', 'RESET'].includes(req.body.purpose) ? req.body.purpose : 'LOGIN';
  const { user, identifier } = findByIdentifier(req.body);
  if (!user) throw new AppError('No encontramos una cuenta con esos datos', 404);

  store.otps.filter((o) => o.identifier === identifier && o.purpose === purpose && !o.usedAt).forEach((o) => { o.usedAt = new Date(); });
  const code = String(crypto.randomInt(100000, 1000000));
  store.otps.push({
    id: store.nextId('otps'), identifier, purpose, codeHash: sha256(code), attempts: 0, usedAt: null,
    expiresAt: new Date(Date.now() + config.otp.ttlMinutes * 60000), createdAt: new Date()
  });
  NotificationService.sendOTP({ identifier, code, purpose });

  res.status(200).json({
    success: true,
    message: `Código enviado a ${identifier}`,
    expiresInSeconds: config.otp.ttlMinutes * 60,
    // Solo en desarrollo, para poder probar sin proveedor de SMS
    ...(config.exposeOtp && { otpCode: code })
  });
});

const consumeOtp = ({ identifier, code, purposes }) => {
  const otp = [...store.otps].reverse().find((o) => o.identifier === identifier && purposes.includes(o.purpose) && !o.usedAt);
  if (!otp || otp.expiresAt <= new Date()) throw new AppError('El código expiró o no existe. Solicita uno nuevo', 400);
  if (otp.attempts >= config.otp.maxAttempts) throw new AppError('Demasiados intentos. Solicita un código nuevo', 429);
  if (sha256(code) !== otp.codeHash) {
    otp.attempts += 1;
    throw new AppError('Código OTP inválido', 400);
  }
  otp.usedAt = new Date();
  return otp;
};

const verifyOTP = asyncHandler(async (req, res) => {
  requireFields(req.body, ['code']);
  const { user, identifier } = findByIdentifier(req.body);
  if (!user) throw new AppError('No encontramos una cuenta con esos datos', 404);
  consumeOtp({ identifier, code: String(req.body.code), purposes: ['LOGIN', 'VERIFY'] });
  if (identifier.includes('@')) user.emailVerified = true;
  else user.phoneVerified = true;
  res.status(200).json({ success: true, message: 'Verificación exitosa', data: issueTokens(user, user.role) });
});

const forgotPassword = asyncHandler(async (req, res) => {
  req.body.purpose = 'RESET';
  const { user } = findByIdentifier(req.body);
  // Respuesta neutra para no revelar si la cuenta existe
  if (!user) return res.status(200).json({ success: true, message: 'Si la cuenta existe, enviamos un código' });
  return sendOTP(req, res, () => {});
});

const resetPassword = asyncHandler(async (req, res) => {
  requireFields(req.body, ['code', 'newPassword']);
  if (String(req.body.newPassword).length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres', 400);
  const { user, identifier } = findByIdentifier(req.body);
  if (!user) throw new AppError('Código inválido o expirado', 400);
  consumeOtp({ identifier, code: String(req.body.code), purposes: ['RESET'] });
  user.passwordHash = await bcrypt.hash(String(req.body.newPassword), 10);
  revokeSessions(user.id);
  res.status(200).json({ success: true, message: 'Contraseña actualizada. Inicia sesión de nuevo' });
});

const refresh = asyncHandler(async (req, res) => {
  requireFields(req.body, ['refreshToken']);
  const session = store.sessions.find((s) => s.refreshHash === sha256(req.body.refreshToken));
  if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new AppError('Sesión inválida o expirada', 401);
  const user = store.users.find((u) => u.id === session.userId && !u.deletedAt);
  if (!user) throw new AppError('Sesión inválida o expirada', 401);
  session.revokedAt = new Date();
  res.status(200).json({ success: true, data: issueTokens(user, session.role) });
});

const logout = asyncHandler(async (req, res) => {
  const session = req.body.refreshToken && store.sessions.find((s) => s.refreshHash === sha256(req.body.refreshToken));
  if (session) session.revokedAt = new Date();
  res.status(200).json({ success: true, message: 'Sesión cerrada' });
});

const currentUser = (req) => store.users.find((u) => u.id === req.user.id);

const me = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  res.status(200).json({ success: true, data: { ...publicUser(user), activeRole: req.user.role } });
});

const updateMe = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { name, locale, country, preferences } = req.body;
  if (name) user.name = String(name).trim();
  if (locale) user.locale = String(locale);
  if (country) {
    if (!store.countries[country]) throw new AppError('País no soportado', 400);
    user.country = country;
  }
  if (req.body.phone !== undefined) {
    const phone = normalizePhone(req.body.phone);
    if (!phone) throw new AppError('Celular inválido', 400);
    if (store.users.some((u) => u.id !== user.id && !u.deletedAt && u.phone === phone)) throw new AppError('El celular ya está en uso', 409);
    if (phone !== user.phone) { user.phone = phone; user.phoneVerified = false; }
  }
  if (preferences && typeof preferences === 'object') {
    ['push', 'email', 'whatsapp'].forEach((k) => { if (typeof preferences[k] === 'boolean') user.preferences[k] = preferences[k]; });
  }
  res.status(200).json({ success: true, data: publicUser(user) });
});

// El mockup permite cambiar entre modo cliente y técnico
const switchMode = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const { role } = req.body;
  if (!['CLIENT', 'TECHNICIAN'].includes(role)) throw new AppError('role debe ser CLIENT o TECHNICIAN', 400);
  if (!user.roles.includes(role)) {
    if (role === 'TECHNICIAN') technicianService.createProfile(user, req.body);
    user.roles.push(role);
  }
  res.status(200).json({ success: true, data: issueTokens(user, role) });
});

const addConsent = asyncHandler(async (req, res) => {
  const { type, version = '1.0', granted = true } = req.body;
  requireFields(req.body, ['type']);
  const user = currentUser(req);
  user.consents.push({ type, version, granted: granted !== false, acceptedAt: new Date(), ip: req.ip });
  if (type === 'WHATSAPP') user.preferences.whatsapp = granted !== false;
  res.status(201).json({ success: true, data: user.consents });
});

const listConsents = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: currentUser(req).consents });
});

// HX-01: derecho de acceso y portabilidad
const exportData = asyncHandler(async (req, res) => {
  const user = currentUser(req);
  const tech = technicianService.getByUserId(user.id);
  res.status(200).json({
    success: true,
    data: {
      user: publicUser(user),
      technicianProfile: tech || null,
      addresses: store.addresses.filter((a) => a.userId === user.id),
      equipments: store.equipments.filter((e) => e.userId === user.id),
      orders: store.orders.filter((o) => o.clientId === user.id || o.technicianUserId === user.id),
      reviews: store.reviews.filter((r) => r.clientId === user.id),
      notifications: store.notifications.filter((n) => n.userId === user.id),
      exportedAt: new Date()
    }
  });
});

// HX-01: derecho de supresión (anonimiza; conserva órdenes y pagos por obligación contable)
const deleteAccount = asyncHandler(async (req, res) => {
  requireFields(req.body, ['password']);
  const user = currentUser(req);
  if (!(await bcrypt.compare(String(req.body.password), user.passwordHash))) throw new AppError('Contraseña incorrecta', 401);
  const open = store.orders.some((o) => ACTIVE_STATES.includes(o.state) && (o.clientId === user.id || o.technicianUserId === user.id));
  if (open) throw new AppError('Tienes órdenes en curso. Ciérralas o cancélalas antes de eliminar tu cuenta', 409);

  const tech = technicianService.getByUserId(user.id);
  if (tech) { tech.available = false; tech.businessName = 'Negocio eliminado'; tech.description = ''; }
  revokeSessions(user.id);
  store.addresses = store.addresses.filter((a) => a.userId !== user.id);
  store.paymentMethods = store.paymentMethods.filter((m) => m.userId !== user.id);
  store.notifications = store.notifications.filter((n) => n.userId !== user.id);
  Object.assign(user, { name: 'Usuario eliminado', email: null, phone: null, passwordHash: null, deletedAt: new Date() });
  res.status(200).json({ success: true, message: 'Cuenta eliminada' });
});

module.exports = {
  register, login, sendOTP, verifyOTP, forgotPassword, resetPassword, refresh, logout, me, updateMe, switchMode,
  addConsent, listConsents, exportData, deleteAccount
};
