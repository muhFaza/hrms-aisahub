import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../lib/httpError';

// Guards a route to the given role(s). Usage: requireRole('HR').
export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new HttpError(401, 'Authentication required');
    }
    if (!roles.includes(req.user.roleName)) {
      throw new HttpError(403, 'Insufficient permissions');
    }
    next();
  };
}
