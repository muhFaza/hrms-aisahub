import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import { uploadDir } from '../../../middleware/upload';
import { createEmployeeWithUser, resetDb, signToken } from '../../../__tests__/helpers/factories';

// Complements reimbursements.service.test.ts: multer writes the evidence file to disk
// before validation runs, so only a request through the full middleware chain can show
// whether a rejected claim leaves an orphan behind.
const API = '/api/v1/reimbursements';

function uploadedFiles(): string[] {
  return fs.readdirSync(uploadDir);
}

// fs.rm in the error handler is fire-and-forget, so the response can beat the unlink.
async function waitForFileCount(expected: number): Promise<string[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = uploadedFiles();
    if (files.length === expected) return files;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return uploadedFiles();
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /reimbursements — orphaned uploads', () => {
  it('deletes the uploaded file when validation rejects the claim', async () => {
    const { user } = await createEmployeeWithUser();
    const before = uploadedFiles();

    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .field('date', '2026-07-06')
      .field('amount', '250000')
      // Blank description: rejected by Zod, after multer has already written the file.
      .field('description', '   ')
      .attach('evidence', Buffer.from('%PDF-1.4 receipt'), {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(await prisma.reimbursement.count()).toBe(0);
    expect(await waitForFileCount(before.length)).toEqual(before);
  });

  it('keeps the uploaded file when the claim is accepted', async () => {
    const { user } = await createEmployeeWithUser();

    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .field('date', '2026-07-06')
      .field('amount', '250000')
      .field('description', 'Client taxi')
      .attach('evidence', Buffer.from('%PDF-1.4 receipt'), {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    const stored = await prisma.reimbursement.findFirstOrThrow();
    expect(stored.evidenceFilePath).toBe(res.body.evidenceFilePath);

    const filePath = path.join(uploadDir, path.basename(stored.evidenceFilePath));
    expect(fs.existsSync(filePath)).toBe(true);
    fs.rmSync(filePath, { force: true });
  });
});
