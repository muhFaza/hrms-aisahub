import type { Request, Response } from 'express';
import { HttpError } from '../../lib/httpError';
import * as leaveService from './service';
import type { CalendarQuery, ListLeaveQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await leaveService.listLeave(req.query as unknown as ListLeaveQuery, req.user!);
  res.json(result);
}

export async function balance(req: Request, res: Response): Promise<void> {
  const { roleName, employeeId } = req.user!;
  let targetId: number;
  if (roleName === 'HR') {
    const queried = req.query.employeeId;
    if (!queried) {
      throw new HttpError(400, 'employeeId query parameter is required for HR');
    }
    targetId = Number(queried);
  } else {
    if (!employeeId) {
      throw new HttpError(400, 'No employee profile is linked to this account');
    }
    targetId = employeeId;
  }
  res.json(await leaveService.getBalance(targetId));
}

export async function balances(_req: Request, res: Response): Promise<void> {
  res.json(await leaveService.getBalances());
}

export async function calendar(req: Request, res: Response): Promise<void> {
  const { month } = req.query as unknown as CalendarQuery;
  res.json(await leaveService.getCalendar(month));
}

export async function create(req: Request, res: Response): Promise<void> {
  const created = await leaveService.submitLeave(req.user!, req.body);
  res.status(201).json(created);
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await leaveService.cancelLeave(id, req.user!);
  res.json({ success: true });
}
