const express = require('express');
const router = express.Router();
const c = require('../controllers/appointmentController');
const { authenticate, authorize } = require('../middlewares/authMiddleware');

router.use(authenticate);
router.post('/', authorize('CLIENT'), c.createAppointment);
router.get('/', authorize('CLIENT', 'TECHNICIAN', 'ADMIN'), c.listAppointments);
router.get('/:id', authorize('CLIENT', 'TECHNICIAN', 'ADMIN'), c.getAppointment);
router.post('/:id/cancel', authorize('CLIENT', 'TECHNICIAN'), c.cancelAppointment);
router.patch('/:id/reschedule', authorize('CLIENT', 'TECHNICIAN'), c.rescheduleAppointment);
router.post('/:id/reschedule', authorize('CLIENT', 'TECHNICIAN'), c.rescheduleAppointment);

module.exports = router;
