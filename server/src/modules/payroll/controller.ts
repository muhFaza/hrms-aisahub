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

// The service returns a finished document; the controller only sets the download headers.
// X-Export-* is read by the UI to report rows the payout file left out, so an exclusion is
// never silent. Both are exposed to the browser — the SPA is same-origin in production but
// runs through the Vite proxy in development.
function sendDocument(res: Response, doc: payrollService.ExportDocument): void {
  res.setHeader('Content-Type', doc.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${doc.filename}"`);
  if (doc.included !== undefined) {
    res.setHeader('X-Export-Included', String(doc.included));
    res.setHeader('X-Export-Excluded', String(doc.excluded ?? 0));
    res.setHeader('Access-Control-Expose-Headers', 'X-Export-Included, X-Export-Excluded');
  }
  res.send(doc.body);
}

export async function exportPeriodPdf(req: Request, res: Response): Promise<void> {
  sendDocument(res, await payrollService.exportPeriodPdf(Number(req.params.id)));
}

export async function exportPeriodCsv(req: Request, res: Response): Promise<void> {
  sendDocument(res, await payrollService.exportPeriodCsv(Number(req.params.id)));
}

export async function exportPayslipPdf(req: Request, res: Response): Promise<void> {
  sendDocument(res, await payrollService.exportPayslipPdf(Number(req.params.id), req.user!));
}
