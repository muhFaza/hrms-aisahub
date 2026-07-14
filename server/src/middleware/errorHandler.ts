import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/httpError';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

// Central error handler: Zod → 400 with field details, known Prisma errors mapped, generic 500.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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
