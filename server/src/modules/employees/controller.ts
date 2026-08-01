import path from 'node:path';
import fs from 'node:fs';
import type { Request, Response } from 'express';
import { uploadDir } from '../../middleware/upload';
import { HttpError } from '../../lib/httpError';
import * as employeesService from './service';
import type { ListEmployeesQuery } from './schemas';

// Employees may only reach their own record; HR reaches any.
function assertCanView(req: Request, employeeId: number): void {
  const { roleName, employeeId: ownEmployeeId } = req.user!;
  if (roleName !== 'HR' && ownEmployeeId !== employeeId) {
    throw new HttpError(403, 'You can only access your own employee record');
  }
}

export async function list(req: Request, res: Response): Promise<void> {
  const result = await employeesService.listEmployees(req.query as unknown as ListEmployeesQuery);
  res.json(result);
}

export async function getById(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  assertCanView(req, id);
  res.json(await employeesService.getEmployee(id));
}

export async function create(req: Request, res: Response): Promise<void> {
  const employee = await employeesService.createEmployee(req.body, req.user!.userId);
  res.status(201).json(employee);
}

export async function update(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await employeesService.updateEmployee(id, req.body, req.user!.userId));
}

export async function terminate(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.json(await employeesService.terminateEmployee(id, req.body, req.user!.userId));
}

export async function rehire(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  res.status(201).json(await employeesService.rehireEmployee(id, req.body, req.user!.userId));
}

export async function uploadContract(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!req.file) {
    throw new HttpError(400, 'No contract file uploaded');
  }
  const employee = await employeesService.setContractFile(id, req.file.filename);
  res.json(employee);
}

export async function downloadContract(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  assertCanView(req, id);
  const employee = await employeesService.getEmployee(id);
  if (!employee.contractFilePath) {
    throw new HttpError(404, 'No contract file on record');
  }
  // basename guards against path traversal from a stored value.
  const filePath = path.join(uploadDir, path.basename(employee.contractFilePath));
  if (!fs.existsSync(filePath)) {
    throw new HttpError(404, 'Contract file is missing on disk');
  }
  res.download(filePath);
}
