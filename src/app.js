const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middlewares/errorHandler');
const { PUBLIC_DIR } = require('./middlewares/upload');

const seedModule = require('./models/seed');
if (config.seedData) seedModule.seed();
else seedModule.bootstrap(config);

const app = express();

// Render (y cualquier balanceador) termina TLS delante de la app: necesario para req.ip y los límites por IP
app.set('trust proxy', 1);

// Las imágenes de /uploads se consumen desde el front en otro origen
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined));
if (config.nodeEnv !== 'test') app.use(morgan(config.isProduction ? 'combined' : 'dev'));

if (config.nodeEnv !== 'test') {
  const limiter = (max, windowMs = 15 * 60 * 1000) =>
    rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { success: false, message: 'Demasiadas peticiones, intenta más tarde' } });
  app.use('/api/v1', limiter(600));
  app.use(['/api/v1/auth/login', '/api/v1/auth/otp', '/api/v1/auth/verify', '/api/v1/auth/password', '/api/v1/auth/register'], limiter(30));
}
// rawBody permite validar la firma HMAC de los webhooks de pago
app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(PUBLIC_DIR, { index: false, dotfiles: 'deny' }));
app.use('/api/v1', routes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Sr Robot Backend API', timestamp: new Date() });
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
