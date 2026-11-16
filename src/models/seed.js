const bcrypt = require('bcryptjs');
const store = require('./store');
const { PLANS } = require('../constants/roles');
const { DAY_KEYS } = require('../utils/dates');

const DEFAULT_PASSWORD = 'Password123!';

const defaultSchedule = () =>
  DAY_KEYS.reduce((acc, key) => {
    acc[key] = { enabled: key !== 'sun', open: key === 'sat' ? '09:00' : '08:00', close: key === 'sat' ? '14:00' : '18:00' };
    return acc;
  }, {});

const seedCountries = () => {
  const latam = (code, name, locale, currency, methods, taxes) => ({
    code, name, locale, currency, minorUnits: currency === 'CLP' ? 0 : 2,
    paymentMethods: methods, dataRegion: 'LATAM', privacyLaw: taxes, active: true
  });
  const list = [
    { code: 'CO', name: 'Colombia', locale: 'es-CO', currency: 'COP', minorUnits: 0, paymentMethods: ['NEQUI', 'DAVIPLATA', 'CARD', 'CASH'], dataRegion: 'LATAM', privacyLaw: 'Ley 1581', active: true },
    latam('MX', 'México', 'es-MX', 'MXN', ['MERCADO_PAGO', 'SPEI', 'OXXO', 'CODI', 'CARD', 'CASH'], 'LFPDPPP'),
    latam('AR', 'Argentina', 'es-AR', 'ARS', ['MERCADO_PAGO', 'TRANSFERENCIA_3', 'CARD', 'CASH'], 'Ley 25.326'),
    latam('CL', 'Chile', 'es-CL', 'CLP', ['WEBPAY', 'TRANSFERENCIA', 'CARD', 'CASH'], 'Ley 19.628'),
    latam('PE', 'Perú', 'es-PE', 'PEN', ['YAPE', 'PLIN', 'PAGOEFECTIVO', 'CARD', 'CASH'], 'Ley 29733'),
    { code: 'BR', name: 'Brasil', locale: 'pt-BR', currency: 'BRL', minorUnits: 2, paymentMethods: ['PIX', 'CARD'], dataRegion: 'LATAM', privacyLaw: 'LGPD', active: true },
    { code: 'US', name: 'Estados Unidos', locale: 'en-US', currency: 'USD', minorUnits: 2, paymentMethods: ['APPLE_PAY', 'CARD', 'STRIPE', 'VENMO'], dataRegion: 'LATAM', privacyLaw: 'CCPA/CPRA', active: true },
    { code: 'ES', name: 'España', locale: 'es-ES', currency: 'EUR', minorUnits: 2, paymentMethods: ['BIZUM', 'CARD', 'STRIPE'], dataRegion: 'EU', privacyLaw: 'RGPD y LOPDGDD', active: true },
    { code: 'DE', name: 'Alemania', locale: 'de-DE', currency: 'EUR', minorUnits: 2, paymentMethods: ['PAYPAL', 'SEPA_DIRECT_DEBIT', 'KLARNA'], dataRegion: 'EU', privacyLaw: 'RGPD y BDSG', active: true }
  ];
  list.forEach((c) => { store.countries[c.code] = c; });
};

const seedSettings = () => {
  store.settings = {
    plans: JSON.parse(JSON.stringify(PLANS)),
    categories: ['Smartphones', 'Laptops', 'Tablets', 'Consolas', 'Televisores', 'Electrodomésticos', 'Audio', 'Cámaras'],
    // La comisión transaccional queda apagada en el lanzamiento (sección 8 del PDF)
    commissions: { transactionEnabled: false, transactionRate: 0.12, b2bRate: 0.06 },
    shipping: { freeFrom: 200000, fee: 12000 },
    matching: { maxTechnicians: 3, radiusKm: 30, quoteExpiryHours: 24 },
    // Porcentaje reembolsado al cliente según el estado de la orden al cancelar
    cancellation: { SOLICITADO: 1, DIAGNOSTICO: 0.8 }
  };
};

const seed = () => {
  if (store.users.length) return;
  seedCountries();
  seedSettings();

  const passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 8);
  const addUser = (name, email, phone, role) => {
    const user = {
      id: store.nextId('users'), name, email, phone, passwordHash, roles: [role], role,
      country: 'CO', locale: 'es-CO', emailVerified: true, phoneVerified: true,
      consents: [{ type: 'TERMS_AND_PRIVACY', version: '1.0', acceptedAt: new Date() }],
      preferences: { push: true, email: true, whatsapp: false },
      createdAt: new Date(), deletedAt: null
    };
    store.users.push(user);
    return user;
  };

  addUser('Juan Cliente', 'cliente@srrobot.com', '+573001234567', 'CLIENT');
  const supplier = addUser('RepuestosExpress B2B', 'proveedor@srrobot.com', '+573201112233', 'SUPPLIER');
  addUser('Admin Sr Robot', 'admin@srrobot.com', '+573009998877', 'ADMIN');

  const techSeeds = [
    {
      name: 'Carlos Fix Tech', email: 'tecnico@srrobot.com', phone: '+573109876543', plan: 'PRO', home: true, status: 'VERIFIED',
      cats: ['Smartphones', 'Laptops', 'Consolas'], lat: 4.6097, lng: -74.0817, address: 'Carrera 7 # 45-12, Bogotá',
      services: [
        ['Cambio de pantalla OLED', 180000, '2 horas', 2],
        ['Mantenimiento preventivo laptop', 90000, '3 horas', 3],
        ['Reparación de placa', 250000, '24 horas', 24]
      ],
      ratings: [5, 5, 5, 4, 5]
    },
    {
      name: 'TecnoCel Chapinero', email: 'tecnico2@srrobot.com', phone: '+573101111111', plan: 'BASIC', home: true, status: 'VERIFIED',
      cats: ['Smartphones', 'Tablets'], lat: 4.6486, lng: -74.0628, address: 'Calle 63 # 9-20, Bogotá',
      services: [['Cambio de batería', 80000, '1 hora', 1], ['Cambio de pantalla', 150000, '2 horas', 2]],
      ratings: [5, 4, 5]
    },
    {
      name: 'Laptop Doctor', email: 'tecnico3@srrobot.com', phone: '+573102222222', plan: 'PREMIUM', home: false, status: 'VERIFIED',
      cats: ['Laptops', 'Tablets'], lat: 4.711, lng: -74.0721, address: 'Calle 100 # 15-30, Bogotá',
      services: [['Limpieza y pasta térmica', 70000, '2 horas', 2], ['Cambio de disco SSD', 160000, '1 hora', 1]],
      ratings: [4, 4, 5, 5]
    },
    {
      name: 'Electro Hogar Express', email: 'tecnico4@srrobot.com', phone: '+573103333333', plan: 'BASIC', home: true, status: 'VERIFIED',
      cats: ['Electrodomésticos', 'Televisores', 'Audio'], lat: 4.5981, lng: -74.076, address: 'Carrera 10 # 20-15, Bogotá',
      services: [['Diagnóstico de televisor', 60000, '1 hora', 1], ['Reparación de nevera', 140000, '4 horas', 4]],
      ratings: [4, 5]
    },
    {
      name: 'GameFix Bogotá', email: 'tecnico5@srrobot.com', phone: '+573104444444', plan: 'PRO', home: true, status: 'IN_REVIEW',
      cats: ['Consolas', 'Cámaras'], lat: 4.67, lng: -74.05, address: 'Calle 85 # 12-40, Bogotá',
      services: [['Reparación HDMI consola', 120000, '3 horas', 3]],
      ratings: []
    }
  ];

  techSeeds.forEach((t) => {
    const user = addUser(t.name, t.email, t.phone, 'TECHNICIAN');
    const tech = {
      id: store.nextId('technicians'), userId: user.id, businessName: t.name, description: `${t.name}: reparación con garantía.`,
      category: t.cats[0], categories: t.cats, rating: 0, reviewsCount: 0,
      verificationStatus: t.status, isVerified: t.status === 'VERIFIED', verificationNote: null,
      location: { lat: t.lat, lng: t.lng, address: t.address, city: 'Bogotá' },
      homeService: t.home, homeExtraFee: 15000, coverageRadiusKm: 15, available: true, responseTime: '15 min',
      services: t.services.map(([name, priceFrom, estimatedTime, estimatedHours]) => ({
        id: store.nextId('services'), name, priceFrom, estimatedTime, estimatedHours, warrantyDays: 90, active: true
      })),
      schedule: defaultSchedule(), blocks: [], documents: [], photos: [],
      plan: t.plan, wallet: { held: 0, available: 0, withdrawn: 0 }, createdAt: new Date()
    };
    store.technicians.push(tech);
    // Reseñas de arranque (no ligadas a órdenes) para que el directorio no se vea vacío
    t.ratings.forEach((rating) => {
      store.reviews.push({
        id: store.nextId('reviews'), orderId: null, technicianId: tech.id, clientId: 1, clientName: 'Juan Cliente',
        rating, tags: [], comment: 'Buen servicio.', hidden: false, reply: null, seeded: true, createdAt: new Date()
      });
    });
    const visible = store.reviews.filter((r) => r.technicianId === tech.id);
    tech.reviewsCount = visible.length;
    tech.rating = visible.length ? parseFloat((visible.reduce((s, r) => s + r.rating, 0) / visible.length).toFixed(1)) : 0;
    if (tech.plan !== 'BASIC') {
      const price = store.settings.plans[tech.plan].price;
      const start = new Date();
      store.subscriptions.push({
        id: store.nextId('subscriptions'), technicianId: tech.id, plan: tech.plan, status: 'ACTIVE', price, currency: 'COP',
        paymentMethod: 'CARD', cancelAtPeriodEnd: false, currentPeriodStart: start,
        currentPeriodEnd: new Date(start.getTime() + 30 * 86400000), nextBillingDate: new Date(start.getTime() + 30 * 86400000),
        createdAt: start
      });
    }
  });

  [
    ['Pantalla iPhone 13 OLED OEM', 'Pantallas', 210000, 15],
    ['Batería Samsung S21 Ultra original', 'Baterías', 85000, 30],
    ['Pasta térmica MX-4 4g', 'Insumos', 35000, 50],
    ['Disco SSD 480GB', 'Almacenamiento', 190000, 20]
  ].forEach(([name, category, price, stock]) => {
    store.spareParts.push({
      id: store.nextId('spareParts'), supplierId: supplier.id, name, category, price, stock,
      description: '', active: true, createdAt: new Date()
    });
  });
};

// Producción sin datos de demo: crea solo la configuración base y un administrador inicial
const bootstrap = ({ adminEmail, adminPassword }) => {
  if (store.users.length) return;
  seedCountries();
  seedSettings();
  if (!adminEmail || !adminPassword) return;
  store.users.push({
    id: store.nextId('users'), name: 'Administrador', email: adminEmail.trim().toLowerCase(), phone: null,
    passwordHash: bcrypt.hashSync(adminPassword, 10), roles: ['ADMIN'], role: 'ADMIN', country: 'CO', locale: 'es-CO',
    emailVerified: true, phoneVerified: false, consents: [], preferences: { push: true, email: true, whatsapp: false },
    createdAt: new Date(), deletedAt: null
  });
};

module.exports = { seed, bootstrap, DEFAULT_PASSWORD, defaultSchedule };
