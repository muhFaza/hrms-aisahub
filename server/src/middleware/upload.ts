import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { HttpError } from '../lib/httpError';

const uploadDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});

// Disk storage under server/uploads/, 5MB cap, PDF/JPG/PNG only.
export const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, 'Only PDF, JPG, and PNG files are allowed'));
    }
  },
});

export { uploadDir };
