const jwt = require('jsonwebtoken');
const config = require('../config/env');
const store = require('../models/store');

const register = async (req, res, next) => {
  try {
    const { name, email, phone, role = 'CLIENT' } = req.body;
    const existing = store.users.find(u => u.email === email);
    if (existing) {
      return res.status(400).json({ success: false, message: 'El correo ya se encuentra registrado' });
    }

    const newUser = {
      id: store.users.length + 1,
      name,
      email,
      phone,
      role
    };
    store.users.push(newUser);

    if (role === 'TECHNICIAN') {
      store.technicians.push({
        id: store.technicians.length + 1,
        userId: newUser.id,
        businessName: name,
        category: 'General',
        rating: 5.0,
        reviewsCount: 0,
        isVerified: false,
        verificationStatus: 'PENDING',
        location: { lat: 4.6097, lng: -74.0817, address: 'Bogotá, Colombia' },
        homeService: true,
        homeExtraFee: 15000,
        services: [],
        plan: 'BASIC',
        balance: { held: 0, available: 0, withdrawn: 0 }
      });
    }

    const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, config.jwtSecret, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      data: { user: newUser, token }
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = store.users.find(u => u.email === email);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
    res.status(200).json({
      success: true,
      message: 'Inicio de sesión exitoso',
      data: { user, token }
    });
  } catch (error) {
    next(error);
  }
};

const sendOTP = async (req, res, next) => {
  try {
    const { phone } = req.body;
    res.status(200).json({ success: true, message: `Código OTP enviado exitosamente al número ${phone}`, otpCode: '123456' });
  } catch (error) {
    next(error);
  }
};

const verifyOTP = async (req, res, next) => {
  try {
    const { phone, code } = req.body;
    if (code === '123456') {
      res.status(200).json({ success: true, message: 'Teléfono verificado correctamente' });
    } else {
      res.status(400).json({ success: false, message: 'Código OTP inválido' });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = { register, login, sendOTP, verifyOTP };
