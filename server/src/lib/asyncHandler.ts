import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Express 4 does not catch rejected promises; this forwards them to errorHandler.
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
