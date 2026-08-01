import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { HttpError } from '../lib/httpError';
import { env } from '../config/env';

// Defaults to <cwd>/uploads; the container overrides it via UPLOAD_DIR so
// attachments land on a mounted volume and survive redeploys.
const uploadDir = env.uploadDir;
fs.mkdirSync(uploadDir, { recursive: true });

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new HttpError(400, 'Only PDF, JPG, and PNG files are allowed'));
    }
  },
});

// Removes a stored upload from disk; missing files are ignored and failures never throw.
export function removeUploadedFile(filename: string | null | undefined): void {
  if (!filename) return;
  const filePath = path.join(uploadDir, path.basename(filename));
  fs.rm(filePath, { force: true }, () => undefined);
}

export { uploadDir };
