import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { HttpError } from '../lib/httpError';

export interface AuthUser {
  userId: number;
  roleName: string;
  employeeId: number | null;
}

// Shape of the signed JWT payload (issued by the auth module in Phase 2).
export interface AuthTokenPayload {
  userId: number;
  roleName: string;
  employeeId: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// Verifies the Bearer token, confirms the user is still active, and attaches req.user.
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  verifyAndAttach(req, next).catch(next);
}

// Async worker so the DB lookup's rejection is forwarded to errorHandler via .catch(next).
async function verifyAndAttach(req: Request, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }

  const token = header.slice('Bearer '.length).trim();
  let payload: AuthTokenPayload;
  try {
    payload = jwt.verify(token, env.jwtSecret) as unknown as AuthTokenPayload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  // Reject tokens whose user has since been deleted or deactivated (single indexed PK lookup).
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isActive: true },
  });
  if (!user || !user.isActive) {
    throw new HttpError(401, 'Account is inactive or no longer exists');
  }

  req.user = {
    userId: payload.userId,
    roleName: payload.roleName,
    employeeId: payload.employeeId ?? null,
  };
  next();
}
