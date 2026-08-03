import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  calendarPeriodRange,
  createEmployeeWithUser,
  createUser,
  finalizePeriod,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';
import * as payrollService from '../service';

// Complements payroll.service.test.ts: those call the service directly and so cannot catch an
// export route that forgot requireRole('HR'). These go through the full middleware chain.
const API = '/api/v1/payroll';

beforeEach(async () => {
  await resetDb();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ rates: { IDR: 16_000 } }),
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await prisma.$disconnect();
});

async function hrToken(): Promise<{ token: string; userId: number }> {
  const user = await createUser({ roleName: 'HR' });
  return { token: signToken(user), userId: user.id };
}

// Builds a real finalized period through the service, so the payslip rows under test are the
// same snapshots production writes.
async function finalizedPeriod(options: { monthlySalary?: number } = {}) {
  const hr = await hrToken();
  const { employee, user } = await createEmployeeWithUser({
    fullName: 'Rina Kartika',
    monthlySalary: options.monthlySalary ?? 12_000_000,
  });
  const period = await prisma.payrollPeriod.create({
    data: {
      year: 2026,
      month: 6,
      ...calendarPeriodRange(2026, 6),
      exchangeRate: 16_000,
      status: 'DRAFT',
    },
  });
  await payrollService.finalizePeriod(period.id, hr.userId);
  const payslip = await prisma.payslip.findFirstOrThrow({
    where: { payrollPeriodId: period.id, employeeId: employee.id },
  });
  return { hr, employee, user, period, payslip };
}

describe('payroll period date administration', () => {
  it('defaults August 2026 to 26 July through 25 August when dates are omitted', async () => {
    const hr = await hrToken();
    const res = await request(app)
      .post(`${API}/periods`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ year: 2026, month: 8 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: '2026-07-26', endDate: '2026-08-25' });
    const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.startDate.toISOString().slice(0, 10)).toBe('2026-07-26');
    expect(stored.endDate.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('handles the default cutoff across the January year boundary', async () => {
    const hr = await hrToken();
    const res = await request(app)
      .post(`${API}/periods`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ year: 2027, month: 1 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: '2026-12-26', endDate: '2027-01-25' });
  });

  it('stores an explicit custom date pair', async () => {
    const hr = await hrToken();
    const res = await request(app)
      .post(`${API}/periods`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({
        year: 2026,
        month: 8,
        startDate: '2026-07-28',
        endDate: '2026-08-24',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ startDate: '2026-07-28', endDate: '2026-08-24' });
  });

  it.each([
    { startDate: '2026-08-25' },
    { endDate: '2026-08-25' },
    { startDate: '2026-08-26', endDate: '2026-08-25' },
    { startDate: '2026-02-31', endDate: '2026-03-25' },
  ])('rejects invalid or incomplete create ranges and stores nothing (%j)', async (range) => {
    const hr = await hrToken();
    const res = await request(app)
      .post(`${API}/periods`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ year: 2026, month: 8, ...range });

    expect(res.status).toBe(400);
    expect(await prisma.payrollPeriod.count()).toBe(0);
  });

  it('updates both dates on a DRAFT period', async () => {
    const hr = await hrToken();
    const period = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 8,
        ...calendarPeriodRange(2026, 8),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });

    const res = await request(app)
      .patch(`${API}/periods/${period.id}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ startDate: '2026-07-26', endDate: '2026-08-25' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ startDate: '2026-07-26', endDate: '2026-08-25' });
  });

  it('keeps the existing exchange-rate update behavior on the consolidated PATCH route', async () => {
    const hr = await hrToken();
    const period = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 8,
        ...calendarPeriodRange(2026, 8),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });

    const res = await request(app)
      .patch(`${API}/periods/${period.id}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ exchangeRate: 17_000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      exchangeRate: 17_000,
      rateSource: 'MANUAL',
      startDate: '2026-08-01',
      endDate: '2026-08-31',
    });
  });

  it('rejects a one-sided DRAFT range update and leaves stored dates unchanged', async () => {
    const hr = await hrToken();
    const period = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 8,
        ...calendarPeriodRange(2026, 8),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });

    const res = await request(app)
      .patch(`${API}/periods/${period.id}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ startDate: '2026-07-26' });

    expect(res.status).toBe(400);
    const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(stored.startDate.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(stored.endDate.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('rejects a FINALIZED date update and leaves the stored range unchanged', async () => {
    const hr = await hrToken();
    const period = await finalizePeriod(2026, 8, hr.userId);

    const res = await request(app)
      .patch(`${API}/periods/${period.id}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ startDate: '2026-07-26', endDate: '2026-08-25' });

    expect(res.status).toBe(409);
    const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: period.id } });
    expect(stored.startDate.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(stored.endDate.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('rejects an overlapping range and leaves the edited period unchanged', async () => {
    const hr = await hrToken();
    await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 7,
        ...calendarPeriodRange(2026, 7),
        exchangeRate: 16_000,
        status: 'FINALIZED',
      },
    });
    const august = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 8,
        ...calendarPeriodRange(2026, 8),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });

    const res = await request(app)
      .patch(`${API}/periods/${august.id}`)
      .set('Authorization', `Bearer ${hr.token}`)
      .send({ startDate: '2026-07-26', endDate: '2026-08-25' });

    expect(res.status).toBe(409);
    const stored = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: august.id } });
    expect(stored.startDate.toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(stored.endDate.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('forbids an employee from editing period dates', async () => {
    const employee = await createEmployeeWithUser();
    const period = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 8,
        ...calendarPeriodRange(2026, 8),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });

    const res = await request(app)
      .patch(`${API}/periods/${period.id}`)
      .set('Authorization', `Bearer ${signToken(employee.user)}`)
      .send({ startDate: '2026-07-26', endDate: '2026-08-25' });

    expect(res.status).toBe(403);
  });
});

describe('payroll export routes — authentication', () => {
  it.each([
    '/periods/1/export/pdf',
    '/periods/1/export/csv',
    '/payslips/1/export/pdf',
  ])('rejects an unauthenticated GET %s with 401', async (path) => {
    const res = await request(app).get(`${API}${path}`);
    expect(res.status).toBe(401);
  });
});

describe('payroll export routes — HR-only period exports', () => {
  it.each(['pdf', 'csv'])('forbids an employee from exporting the period as %s (403)', async (format) => {
    const { period, user } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/periods/${period.id}/export/${format}`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(403);
  });

  it('returns a PDF payroll sheet to HR', async () => {
    const { period, hr } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/periods/${period.id}/export/pdf`)
      .set('Authorization', `Bearer ${hr.token}`)
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="payroll-2026-06.pdf"');
    expect((res.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('returns a payout CSV to HR with the employee row and the inclusion counts', async () => {
    const { period, hr, employee } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/periods/${period.id}/export/csv`)
      .set('Authorization', `Bearer ${hr.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe('attachment; filename="payout-2026-06.csv"');
    expect(res.headers['x-export-included']).toBe('1');
    expect(res.headers['x-export-excluded']).toBe('0');
    expect(res.text).toContain('"Rina Kartika"');
    expect(res.text).toContain(`"PAY-2026-06-${employee.id}"`);
  });

  it('excludes a non-payable employee from the CSV and reports the count', async () => {
    const { period, hr } = await finalizedPeriod();
    // A part-timer with no logged hours nets zero — a payout no gateway can action.
    const idle = await prisma.employee.create({
      data: {
        fullName: 'Idle Parttimer',
        joinDate: new Date('2026-01-01T00:00:00.000Z'),
        position: 'Intern',
        employmentType: 'PART_TIME',
        hourlyRate: 50_000,
      },
    });
    await prisma.payslip.create({
      data: {
        payrollPeriodId: period.id,
        employeeId: idle.id,
        basicSalary: 0,
        totalIdr: 0,
        totalUsd: 0,
        detail: {},
      },
    });

    const res = await request(app)
      .get(`${API}/periods/${period.id}/export/csv`)
      .set('Authorization', `Bearer ${hr.token}`);

    expect(res.status).toBe(200);
    expect(res.headers['x-export-included']).toBe('1');
    expect(res.headers['x-export-excluded']).toBe('1');
    expect(res.text).not.toContain('Idle Parttimer');
  });

  it.each(['pdf', 'csv'])('refuses to export a draft period as %s (409)', async (format) => {
    const hr = await hrToken();
    const draft = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 5,
        ...calendarPeriodRange(2026, 5),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });
    const res = await request(app)
      .get(`${API}/periods/${draft.id}/export/${format}`)
      .set('Authorization', `Bearer ${hr.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Only finalized periods can be exported');
  });

  it.each(['pdf', 'csv'])('returns 404 for an unknown period (%s)', async (format) => {
    const hr = await hrToken();
    const res = await request(app)
      .get(`${API}/periods/9999/export/${format}`)
      .set('Authorization', `Bearer ${hr.token}`);
    expect(res.status).toBe(404);
  });
});

describe('payroll export routes — payslip ownership', () => {
  it('lets an employee download their own payslip', async () => {
    const { payslip, user } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/payslips/${payslip.id}/export/pdf`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('payslip-2026-06-');
  });

  // 404 rather than 403: a 403 would confirm the payslip exists, making the endpoint a
  // headcount oracle for anyone with a login.
  it("hides another employee's payslip behind a 404, not a 403", async () => {
    const { payslip } = await finalizedPeriod();
    const outsider = await createEmployeeWithUser({ fullName: 'Someone Else' });
    const res = await request(app)
      .get(`${API}/payslips/${payslip.id}/export/pdf`)
      .set('Authorization', `Bearer ${signToken(outsider.user)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Payslip not found');
  });

  it('returns the same 404 for a payslip that does not exist', async () => {
    const { user } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/payslips/9999/export/pdf`)
      .set('Authorization', `Bearer ${signToken(user)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Payslip not found');
  });

  it("lets HR download any employee's payslip", async () => {
    const { payslip, hr } = await finalizedPeriod();
    const res = await request(app)
      .get(`${API}/payslips/${payslip.id}/export/pdf`)
      .set('Authorization', `Bearer ${hr.token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  // An HR account with no employee profile must not fall through the ownership check.
  it('does not let an employee-less non-HR account download a payslip', async () => {
    const { payslip } = await finalizedPeriod();
    const orphan = await createUser({ roleName: 'EMPLOYEE', employeeId: null });
    const res = await request(app)
      .get(`${API}/payslips/${payslip.id}/export/pdf`)
      .set('Authorization', `Bearer ${signToken(orphan)}`);
    expect(res.status).toBe(404);
  });
});

describe('payroll preview — payslipId', () => {
  it('exposes payslipId on finalized rows so HR can export each payslip', async () => {
    const { period, payslip } = await finalizedPeriod();
    const preview = await payrollService.getPeriodPreview(period.id);
    expect(preview.rows[0].payslipId).toBe(payslip.id);
  });

  it('omits payslipId on a draft period, which has no stored payslips', async () => {
    await createEmployeeWithUser();
    const draft = await prisma.payrollPeriod.create({
      data: {
        year: 2026,
        month: 5,
        ...calendarPeriodRange(2026, 5),
        exchangeRate: 16_000,
        status: 'DRAFT',
      },
    });
    const preview = await payrollService.getPeriodPreview(draft.id);
    expect(preview.rows[0].payslipId).toBeUndefined();
  });
});
