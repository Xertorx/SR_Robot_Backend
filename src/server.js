const http = require('http');
const config = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const logger = require('./utils/logger');
const realtime = require('./services/realtime');
const reminderService = require('./services/reminderService');

const startServer = async () => {
  await connectDB();

  const server = http.createServer(app);
  realtime.attach(server);
  reminderService.start();

  server.listen(config.port, '0.0.0.0', () => {
    logger.info(`🚀 Servidor Sr Robot ejecutándose en el puerto ${config.port} (${config.nodeEnv})`);
    logger.info(`🔗 URL Base API: http://localhost:${config.port}/api/v1`);
    logger.info(`💬 WebSocket: ws://localhost:${config.port}/chat/{conversationId}?token=...  y  /events?token=...`);
    logger.info(`🏥 Healthcheck: http://localhost:${config.port}/health`);
    if (config.isProduction && !config.seedData && !config.adminEmail) {
      logger.warn('No hay usuarios: define ADMIN_EMAIL y ADMIN_PASSWORD para crear el administrador inicial');
    }
  });

  // Render envía SIGTERM al redesplegar: se cierran conexiones antes de salir
  const shutdown = (signal) => {
    logger.info(`${signal} recibido, cerrando servidor...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

startServer();
