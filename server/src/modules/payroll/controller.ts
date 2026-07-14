import type { Request, Response } from 'express';
import * as payrollService from './service';
import type { CreatePeriodInput, PatchRateInput } from './schemas';

export async function listPeriods(_req: Request, res: Response): Promise<void> {
  res.json(await payrollService.listPeriods());
}

export async function createPeriod(req: Request, res: Response): Promise<void> {
  const { year, month } = req.body as CreatePeriodInput;
  res.status(201).json(await payrollService.createPeriod(year, month));
}

export async function getPeriod(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await payrollService.getPeriodPreview(id));
}

export async function patchRate(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const { exchangeRate } = req.body as PatchRateInput;
  res.json(await payrollService.patchRate(id, exchangeRate));
}

export async function finalize(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await payrollService.finalizePeriod(id, req.user!.userId));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await payrollService.deletePeriod(id);
  res.json({ success: true });
}

export async function myPayslips(req: Request, res: Response): Promise<void> {
  res.json(await payrollService.getMyPayslips(req.user!));
}
