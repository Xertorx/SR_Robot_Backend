const store = require('../models/store');
const { defaultSchedule } = require('../models/seed');
const { toNumberOrNull } = require('../utils/validate');

const BOGOTA = { lat: 4.6097, lng: -74.0817 };

const getById = (id) => store.technicians.find((t) => t.id === Number(id));
const getByUserId = (userId) => store.technicians.find((t) => t.userId === userId);

const normalizeCategories = (data) => {
  const raw = Array.isArray(data.categories) ? data.categories : data.category ? [data.category] : [];
  return [...new Set(raw.map((c) => String(c).trim()).filter(Boolean))];
};

const createProfile = (user, data = {}) => {
  const categories = normalizeCategories(data);
  const lat = toNumberOrNull(data.lat);
  const lng = toNumberOrNull(data.lng);
  const tech = {
    id: store.nextId('technicians'), userId: user.id, businessName: data.businessName || user.name,
    description: data.description || '', category: categories[0] || 'General', categories,
    rating: 0, reviewsCount: 0, verificationStatus: 'PENDING', isVerified: false, verificationNote: null,
    location: {
      lat: lat !== null ? lat : BOGOTA.lat, lng: lng !== null ? lng : BOGOTA.lng,
      address: data.address || 'Bogotá, Colombia', city: data.city || 'Bogotá'
    },
    homeService: data.homeService === undefined ? true : data.homeService === true || data.homeService === 'true',
    homeExtraFee: toNumberOrNull(data.homeExtraFee) !== null ? toNumberOrNull(data.homeExtraFee) : 15000,
    coverageRadiusKm: toNumberOrNull(data.coverageRadiusKm) || 15,
    available: true, responseTime: 'Sin datos', services: [], schedule: defaultSchedule(), blocks: [], documents: [], photos: [],
    plan: 'BASIC', wallet: { held: 0, available: 0, withdrawn: 0 }, createdAt: new Date()
  };
  store.technicians.push(tech);
  return tech;
};

const visibleReviews = (techId) => store.reviews.filter((r) => r.technicianId === techId && !r.hidden);

const ratingDistribution = (techId) => {
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  visibleReviews(techId).forEach((r) => { dist[r.rating] += 1; });
  return dist;
};

const recalcRating = (techId) => {
  const tech = getById(techId);
  if (!tech) return;
  const reviews = visibleReviews(techId);
  tech.reviewsCount = reviews.length;
  tech.rating = reviews.length ? parseFloat((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)) : 0;
};

const completedOrders = (techId) => store.orders.filter((o) => o.technicianId === techId && o.state === 'ENTREGADO').length;

// Vista pública: nunca expone billetera, documentos ni bloqueos internos
const publicView = (tech, extra = {}) => ({
  id: tech.id, businessName: tech.businessName, description: tech.description, category: tech.category,
  categories: tech.categories, rating: tech.rating, reviewsCount: tech.reviewsCount,
  isVerified: tech.isVerified, verificationStatus: tech.verificationStatus, plan: tech.plan,
  location: tech.location, homeService: tech.homeService, homeExtraFee: tech.homeExtraFee,
  coverageRadiusKm: tech.coverageRadiusKm, available: tech.available, responseTime: tech.responseTime,
  schedule: tech.schedule, photos: tech.photos, completedOrders: completedOrders(tech.id),
  services: tech.services.filter((s) => s.active), ...extra
});

const isListed = (tech) => {
  const user = store.users.find((u) => u.id === tech.userId);
  return Boolean(user) && !user.deletedAt;
};

module.exports = {
  getById, getByUserId, createProfile, ratingDistribution, recalcRating, completedOrders, publicView, isListed, visibleReviews
};
