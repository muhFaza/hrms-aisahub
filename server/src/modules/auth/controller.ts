import type { Request, Response } from 'express';
import * as authService from './service';

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = await authService.getMe(req.user!.userId);
  res.json(user);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(req.user!.userId, req.body);
  res.json({ success: true });
}
