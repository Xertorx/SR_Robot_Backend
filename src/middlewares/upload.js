const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/env');
const { AppError } = require('../utils/errors');

const PUBLIC_DIR = path.join(config.uploadsDir, 'public');
const PRIVATE_DIR = path.join(config.uploadsDir, 'private');

const safeExt = (name) => {
  const ext = path.extname(name || '').toLowerCase();
  return /^\.[a-z0-9]{1,6}$/.test(ext) ? ext : '';
};

const makeUpload = ({ dir, mimePattern, maxMb, maxFiles }) =>
  multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt(file.originalname)}`)
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: maxFiles },
    fileFilter: (req, file, cb) =>
      mimePattern.test(file.mimetype) ? cb(null, true) : cb(new AppError('Tipo de archivo no permitido', 400))
  });

// Fotos/video de solicitudes, evidencias y chat (se sirven en /uploads)
const mediaUpload = makeUpload({ dir: PUBLIC_DIR, mimePattern: /^(image\/|video\/mp4|video\/quicktime)/, maxMb: 25, maxFiles: 8 });

// Documentos de verificación: nunca se exponen públicamente
const documentUpload = makeUpload({ dir: PRIVATE_DIR, mimePattern: /^(image\/|application\/pdf)/, maxMb: 10, maxFiles: 5 });

const toMedia = (files = []) =>
  files.map((f) => ({
    url: `/uploads/${f.filename}`,
    type: f.mimetype.startsWith('video') ? 'VIDEO' : 'IMAGE',
    originalName: f.originalname,
    size: f.size
  }));

module.exports = { mediaUpload, documentUpload, toMedia, PUBLIC_DIR, PRIVATE_DIR };
