import type { Request, Response } from 'express';
import * as dashboardService from './service';

export async function get(req: Request, res: Response): Promise<void> {
  const actor = req.user!;
  if (actor.roleName === 'HR') {
    res.json(await dashboardService.getHrDashboard());
  } else {
    res.json(await dashboardService.getEmployeeDashboard(actor));
  }
}
