require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'sr_robot_jwt_secret_key_default',
  dbUri: process.env.DB_URI || 'mongodb://localhost:27017/sr_robot_db',
  currency: process.env.CURRENCY || 'COP',
  countryCode: process.env.COUNTRY_CODE || 'CO'
};
