const ROLES = {
  CLIENT: 'CLIENT',
  TECHNICIAN: 'TECHNICIAN',
  SUPPLIER: 'SUPPLIER',
  ADMIN: 'ADMIN'
};

// Roles que una persona puede elegir al registrarse (ADMIN solo se asigna internamente)
const SELF_REGISTER_ROLES = [ROLES.CLIENT, ROLES.TECHNICIAN, ROLES.SUPPLIER];

// Valores por defecto; en ejecución viven en store.settings.plans y se editan desde el panel admin (HA-04)
const PLANS = {
  BASIC: {
    name: 'Básico',
    price: 0,
    maxQuotes: 10,
    discountSpareParts: 0,
    multiUser: false,
    features: ['Perfil público', 'Hasta 10 solicitudes al mes']
  },
  PRO: {
    name: 'Pro',
    price: 49900,
    maxQuotes: 100,
    discountSpareParts: 0.1,
    multiUser: false,
    features: ['Hasta 100 solicitudes al mes', '10% de descuento en repuestos', 'Insignia Pro']
  },
  PREMIUM: {
    name: 'Premium',
    price: 99900,
    maxQuotes: -1,
    discountSpareParts: 0.15,
    multiUser: true,
    features: ['Solicitudes ilimitadas', '15% de descuento en repuestos', 'Equipo de técnicos']
  }
};

module.exports = { ROLES, SELF_REGISTER_ROLES, PLANS };
