const config = require('../config/env');
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err.message, err.stack);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Error interno en el servidor Sr Robot',
    ...(config.nodeEnv === 'development' && { stack: err.stack })
  });
};

module.exports = { errorHandler };
