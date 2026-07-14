import type { Request, Response } from 'express';
import * as dailyLogsService from './service';
import type { ListDailyLogsQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await dailyLogsService.listDailyLogs(
    req.query as unknown as ListDailyLogsQuery,
    req.user!,
  );
  res.json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const created = await dailyLogsService.createDailyLog(req.user!, req.body);
  res.status(201).json(created);
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await dailyLogsService.updateDailyLog(id, req.user!, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await dailyLogsService.deleteDailyLog(id, req.user!);
  res.json({ success: true });
}
