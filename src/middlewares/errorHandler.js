const config = require('../config/env');
const logger = require('../utils/logger');

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
};

const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Error interno en el servidor Sr Robot';

  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'JSON inválido en el cuerpo de la petición';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera el tamaño permitido' : `Error al subir archivos: ${err.message}`;
  }

  if (statusCode >= 500) logger.error(err.message, err.stack);
  else logger.warn(`${req.method} ${req.originalUrl} -> ${statusCode}: ${message}`);

  res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && config.isProduction ? 'Error interno en el servidor Sr Robot' : message,
    ...(config.nodeEnv === 'development' && statusCode >= 500 && { stack: err.stack })
  });
};

module.exports = { errorHandler, notFound };
