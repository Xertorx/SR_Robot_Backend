const express = require('express');
const router = express.Router();
const c = require('../controllers/configController');

router.get('/countries', c.listCountries);
router.get('/countries/:code', c.getCountry);
router.get('/categories', c.listCategories);

module.exports = router;
