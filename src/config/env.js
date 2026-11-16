const path = require('path');
require('dotenv').config();

const nodeEnv = process.env.NODE_ENV || 'development';

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv,
  isProduction: nodeEnv === 'production',
  jwtSecret: process.env.JWT_SECRET || 'sr_robot_jwt_secret_key_default',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  refreshTokenDays: parseInt(process.env.REFRESH_TOKEN_DAYS, 10) || 30,
  dbUri: process.env.DB_URI || 'mongodb://localhost:27017/sr_robot_db',
  currency: process.env.CURRENCY || 'COP',
  countryCode: process.env.COUNTRY_CODE || 'CO',
  otp: {
    ttlMinutes: parseInt(process.env.OTP_TTL_MINUTES, 10) || 5,
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS, 10) || 5
  },
  payments: {
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'sr_robot_webhook_secret',
    // Simula la pasarela: aprueba el pago de inmediato llamando al mismo manejador del webhook
    autoApprove: process.env.PAYMENT_AUTO_APPROVE !== 'false'
  },
  // En producción los usuarios de demo (contraseña conocida) solo se cargan si SEED_DATA=true
  seedData: process.env.SEED_DATA ? process.env.SEED_DATA === 'true' : nodeEnv !== 'production',
  // Sin proveedor SMS/email, devolver el OTP en la respuesta permite probar el flujo (solo demo)
  exposeOtp: process.env.EXPOSE_OTP ? process.env.EXPOSE_OTP === 'true' : nodeEnv !== 'production',
  adminEmail: process.env.ADMIN_EMAIL || null,
  adminPassword: process.env.ADMIN_PASSWORD || null,
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  uploadsDir: path.resolve(process.env.UPLOADS_DIR || 'uploads')
};

if (nodeEnv === 'production') {
  const missing = ['JWT_SECRET', 'PAYMENT_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`❌ Faltan variables de entorno obligatorias en producción: ${missing.join(', ')}`);
    process.exit(1);
  }
}
