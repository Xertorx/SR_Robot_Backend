const store = require('../models/store');
const { calculateDistanceKm } = require('../utils/geoUtils');
const { stripAccents } = require('../utils/validate');
const technicianService = require('./technicianService');

const ALIASES = {
  celular: 'smartphones', telefono: 'smartphones', movil: 'smartphones', smartphone: 'smartphones', phone: 'smartphones',
  computador: 'laptops', computadora: 'laptops', portatil: 'laptops', notebook: 'laptops', laptop: 'laptops', pc: 'laptops',
  tv: 'televisores', television: 'televisores', televisor: 'televisores',
  tablet: 'tablets', consola: 'consolas', camara: 'camaras', electrodomestico: 'electrodomesticos'
};

const normalizeCategory = (value) => {
  const key = stripAccents(value);
  return ALIASES[key] || key;
};

const matchesCategory = (tech, category) => {
  if (!category) return true;
  const wanted = normalizeCategory(category);
  return tech.categories.some((c) => {
    const have = normalizeCategory(c);
    return have === wanted || have.includes(wanted) || wanted.includes(have);
  });
};

const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
};

// Límite de solicitudes recibidas por mes según el plan (-1 = ilimitado)
const withinPlanLimit = (tech) => {
  const plan = store.settings.plans[tech.plan] || store.settings.plans.BASIC;
  if (plan.maxQuotes < 0) return true;
  const received = store.quoteRequests.filter(
    (r) => r.matchedTechnicianIds.includes(tech.id) && r.createdAt >= monthStart()
  ).length;
  return received < plan.maxQuotes;
};

// Matching por categoría y distancia: hasta N técnicos verificados cerca del cliente
const findMatches = ({ category, lat, lng, isHomeService }) => {
  const { maxTechnicians, radiusKm } = store.settings.matching;
  return store.technicians
    .filter((t) => technicianService.isListed(t) && t.isVerified && t.available)
    .filter((t) => matchesCategory(t, category))
    .filter((t) => !isHomeService || t.homeService)
    .map((t) => ({ tech: t, distanceKm: calculateDistanceKm(lat, lng, t.location.lat, t.location.lng) }))
    .filter(({ tech, distanceKm }) => {
      if (distanceKm === null) return true;
      return distanceKm <= (isHomeService ? Math.min(radiusKm, tech.coverageRadiusKm) : radiusKm);
    })
    .filter(({ tech }) => withinPlanLimit(tech))
    .sort((a, b) => (a.distanceKm === null) - (b.distanceKm === null) || a.distanceKm - b.distanceKm)
    .slice(0, maxTechnicians);
};

module.exports = { findMatches, matchesCategory, normalizeCategory };
