// Almacenamiento en memoria listo para pruebas locales completas sin requerir una BD configurada previa
const users = [
  { id: 1, name: 'Juan Cliente', email: 'cliente@srrobot.com', phone: '+573001234567', role: 'CLIENT' },
  { id: 2, name: 'Carlos Fix Tech', email: 'tecnico@srrobot.com', phone: '+573109876543', role: 'TECHNICIAN' },
  { id: 3, name: 'RepuestosExpress B2B', email: 'proveedor@srrobot.com', phone: '+573201112233', role: 'SUPPLIER' },
  { id: 4, name: 'Admin Sr Robot', email: 'admin@srrobot.com', phone: '+573009998877', role: 'ADMIN' }
];

const technicians = [
  {
    id: 1,
    userId: 2,
    businessName: 'Carlos Fix Tech',
    category: 'Smartphones & Tablets',
    categories: ['Smartphones', 'Laptops', 'Consolas'],
    rating: 4.9,
    reviewsCount: 48,
    isVerified: true,
    verificationStatus: 'VERIFIED',
    location: { lat: 4.6097, lng: -74.0817, address: 'Carrera 7 # 45-12, Bogotá' },
    homeService: true,
    homeExtraFee: 15000,
    responseTime: '15 min',
    services: [
      { id: 101, name: 'Cambio de Pantalla OLED', priceFrom: 180000, estimatedTime: '2 horas' },
      { id: 102, name: 'Mantenimiento preventivo Laptop', priceFrom: 90000, estimatedTime: '3 horas' },
      { id: 103, name: 'Rebaling / Reparación de Placa', priceFrom: 250000, estimatedTime: '24 horas' }
    ],
    plan: 'PRO',
    balance: { held: 180000, available: 450000, withdrawn: 1200000 }
  }
];

const quoteRequests = [];
const quotes = [];
const appointments = [];
const orders = [];
const chatConversations = [];
const chatMessages = [];
const reviews = [];
const spareParts = [
  { id: 1, name: 'Pantalla iPhone 13 OLED OEM', category: 'Pantallas', price: 210000, stock: 15, supplierId: 3 },
  { id: 2, name: 'Batería Samsung S21 Ultra original', category: 'Baterías', price: 85000, stock: 30, supplierId: 3 },
  { id: 3, name: 'Pasta Térmica MX-4 4g', category: 'Insumos', price: 35000, stock: 50, supplierId: 3 }
];
const clientEquipments = [];
const clientAddresses = [];
const disputes = [];

module.exports = {
  users,
  technicians,
  quoteRequests,
  quotes,
  appointments,
  orders,
  chatConversations,
  chatMessages,
  reviews,
  spareParts,
  clientEquipments,
  clientAddresses,
  disputes
};
