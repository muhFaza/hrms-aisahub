import type { Request, Response } from 'express';
import * as overtimeService from './service';
import type { ListOvertimeQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await overtimeService.listOvertime(
    req.query as unknown as ListOvertimeQuery,
    req.user!,
  );
  res.json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const created = await overtimeService.createOvertime(req.user!, req.body);
  res.status(201).json(created);
}

export async function review(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await overtimeService.reviewOvertime(id, req.user!.userId, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await overtimeService.cancelOvertime(id, req.user!);
  res.json({ success: true });
}
