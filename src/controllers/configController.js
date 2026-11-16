const store = require('../models/store');
const subscriptionService = require('../services/subscriptionService');
const { AppError, asyncHandler } = require('../utils/errors');

const listCountries = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: Object.values(store.countries).filter((c) => c.active) });
});

// La app lee idioma, moneda y métodos de pago de aquí, no del código (sección 11 del PDF)
const getCountry = asyncHandler(async (req, res) => {
  const country = store.countries[String(req.params.code).toUpperCase()];
  if (!country || !country.active) throw new AppError('País no disponible', 404);
  res.status(200).json({
    success: true,
    data: { ...country, plans: subscriptionService.planCatalog(), commissions: { b2bRate: store.settings.commissions.b2bRate } }
  });
});

const listCategories = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, data: store.settings.categories });
});

module.exports = { listCountries, getCountry, listCategories };
