const connectDB = async () => {
  try {
    console.log('⚡ Base de datos inicializada (Modo En-Memoria / Persistencia Simulada para API REST)');
  } catch (error) {
    console.error('❌ Error al conectar con la base de datos:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
