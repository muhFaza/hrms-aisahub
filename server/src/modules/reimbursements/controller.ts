import type { Request, Response } from 'express';
import { HttpError } from '../../lib/httpError';
import * as reimbursementsService from './service';
import type { ListReimbursementsQuery } from './schemas';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await reimbursementsService.listReimbursements(
    req.query as unknown as ListReimbursementsQuery,
    req.user!,
  );
  res.json(result);
}

export async function create(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new HttpError(400, 'An evidence file is required');
  }
  const created = await reimbursementsService.createReimbursement(
    req.user!,
    req.body,
    req.file.filename,
  );
  res.status(201).json(created);
}

export async function review(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await reimbursementsService.reviewReimbursement(id, req.user!.userId, req.body));
}

export async function remove(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  await reimbursementsService.cancelReimbursement(id, req.user!);
  res.json({ success: true });
}

export async function downloadEvidence(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const filePath = await reimbursementsService.getEvidencePath(id, req.user!);
  res.download(filePath);
}
