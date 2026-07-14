import type { Request, Response } from 'express';
import * as usersService from './service';

export async function list(_req: Request, res: Response): Promise<void> {
  res.json(await usersService.listUsers());
}

export async function roles(_req: Request, res: Response): Promise<void> {
  res.json(await usersService.listRoles());
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = await usersService.createUser(req.body);
  res.status(201).json(user);
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const user = await usersService.updateUser(id, req.user!.userId, req.body);
  res.json(user);
}
