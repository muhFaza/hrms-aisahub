import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import { HttpError } from '../lib/httpError';
import { MAX_UPLOAD_BYTES, removeUploadedFile } from './upload';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

// Multer writes to disk before validation and the service run, so any request that
// ends up here left its upload orphaned. Only errored requests reach this handler,
// so a successful create never loses its file.
function discardOrphanedUploads(req: Request): void {
  if (req.file) removeUploadedFile(req.file.filename);
  if (!req.files) return;
  // multer's array shape is a flat list; its fields shape is keyed by field name.
  const groups = Array.isArray(req.files) ? [req.files] : Object.values(req.files);
  for (const group of groups) {
    for (const file of group) removeUploadedFile(file.filename);
  }
}

// Central error handler: Zod → 400 with field details, known Prisma errors mapped, generic 500.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  discardOrphanedUploads(req);

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  // Multer rejects oversize or malformed uploads before any handler runs; without this
  // they are unrecognised objects and fall through to a misleading 500.
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `File is too large — the maximum upload size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`
        : err.message;
    res.status(400).json({ error: message, details: { code: err.code } });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        res.status(409).json({ error: 'Unique constraint violation', details: err.meta });
        return;
      case 'P2003':
        res.status(409).json({ error: 'Related record constraint failed', details: err.meta });
        return;
      case 'P2025':
        res.status(404).json({ error: 'Record not found', details: err.meta });
        return;
      default:
        res.status(400).json({ error: 'Database request error', code: err.code, details: err.meta });
        return;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'Invalid database query' });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal Server Error' });
}
