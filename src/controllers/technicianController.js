const store = require('../models/store');
const { calculateDistanceKm } = require('../utils/geoUtils');

const getTechnicians = async (req, res, next) => {
  try {
    const { lat, lng, cat, home, verified, minRating, q } = req.query;
    const clientLat = lat ? parseFloat(lat) : 4.6097; // Bogotá por defecto
    const clientLng = lng ? parseFloat(lng) : -74.0817;

    let results = store.technicians.map(tech => {
      const distance = calculateDistanceKm(clientLat, clientLng, tech.location.lat, tech.location.lng);
      return { ...tech, distanceKm: distance };
    });

    if (cat) results = results.filter(t => t.category.toLowerCase().includes(cat.toLowerCase()));
    if (home === 'true') results = results.filter(t => t.homeService);
    if (verified === 'true') results = results.filter(t => t.isVerified);
    if (minRating) results = results.filter(t => t.rating >= parseFloat(minRating));
    if (q) {
      const queryLower = q.toLowerCase();
      results = results.filter(t =>
        t.businessName.toLowerCase().includes(queryLower) ||
        t.category.toLowerCase().includes(queryLower)
      );
    }

    // Ordenar por cercanía de distancia
    results.sort((a, b) => a.distanceKm - b.distanceKm);

    res.status(200).json({
      success: true,
      count: results.length,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

const getTechnicianById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const tech = store.technicians.find(t => t.id === parseInt(id));
    if (!tech) return res.status(404).json({ success: false, message: 'Técnico no encontrado' });

    const reviews = store.reviews.filter(r => r.technicianId === parseInt(id));

    res.status(200).json({
      success: true,
      data: { ...tech, reviews }
    });
  } catch (error) {
    next(error);
  }
};

const addService = async (req, res, next) => {
  try {
    const { name, priceFrom, estimatedTime } = req.body;
    const tech = store.technicians.find(t => t.userId === req.user.id);
    if (!tech) return res.status(404).json({ success: false, message: 'Perfil de negocio no encontrado' });

    const newService = {
      id: Date.now(),
      name,
      priceFrom: parseFloat(priceFrom),
      estimatedTime
    };
    tech.services.push(newService);

    res.status(201).json({ success: true, message: 'Servicio agregado exitosamente', data: newService });
  } catch (error) {
    next(error);
  }
};

const getAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    const availableSlots = ['08:00 AM', '10:00 AM', '02:00 PM', '04:00 PM'];
    res.status(200).json({ success: true, date: date || new Date().toISOString().split('T')[0], availableSlots });
  } catch (error) {
    next(error);
  }
};

const getWallet = async (req, res, next) => {
  try {
    const tech = store.technicians.find(t => t.userId === req.user.id);
    res.status(200).json({ success: true, data: tech ? tech.balance : { held: 0, available: 0, withdrawn: 0 } });
  } catch (error) {
    next(error);
  }
};

const getAnalytics = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        totalRevenue: 1250000,
        completedOrders: 18,
        conversionRate: '68%',
        profileViews: 142
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getTechnicians, getTechnicianById, addService, getAvailability, getWallet, getAnalytics };
