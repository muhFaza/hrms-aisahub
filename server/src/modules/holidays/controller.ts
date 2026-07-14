import type { Request, Response } from 'express';
import * as holidaysService from './service';
import type { ListHolidaysQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const holidays = await holidaysService.listHolidays(req.query as unknown as ListHolidaysQuery);
  res.json(holidays);
}

export async function create(req: Request, res: Response): Promise<void> {
  const holiday = await holidaysService.createHoliday(req.body);
  res.status(201).json(holiday);
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await holidaysService.updateHoliday(id, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await holidaysService.deleteHoliday(id);
  res.json({ success: true });
}
