const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./routes');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();

// Middlewares globales de seguridad y log
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prefijo API REST v1
app.use('/api/v1', routes);

// Ruta de comprobación de salud del servidor
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'Sr Robot Backend API',
    timestamp: new Date()
  });
});

// Middleware global de errores
app.use(errorHandler);

module.exports = app;
