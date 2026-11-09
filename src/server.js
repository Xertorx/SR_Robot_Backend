const config = require('./config/env');
const connectDB = require('./config/db');
const app = require('./app');
const logger = require('./utils/logger');

const startServer = async () => {
  await connectDB();

  app.listen(config.port, () => {
    logger.info(`🚀 Servidor Sr Robot ejecutándose en el puerto ${config.port}`);
    logger.info(`🔗 URL Base API: http://localhost:${config.port}/api/v1`);
    logger.info(`🏥 Healthcheck: http://localhost:${config.port}/health`);
  });
};

startServer();
