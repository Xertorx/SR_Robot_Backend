const logger = {
  info: (msg, data = '') => console.log(`ℹ️ [INFO] [${new Date().toISOString()}] ${msg}`, data ? JSON.stringify(data) : ''),
  warn: (msg, data = '') => console.warn(`⚠️ [WARN] [${new Date().toISOString()}] ${msg}`, data ? JSON.stringify(data) : ''),
  error: (msg, err = '') => console.error(`❌ [ERROR] [${new Date().toISOString()}] ${msg}`, err)
};

module.exports = logger;
