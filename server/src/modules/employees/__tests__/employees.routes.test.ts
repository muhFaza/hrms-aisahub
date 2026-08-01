import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../../../app';
import { prisma } from '../../../config/prisma';
import {
  createEmployee,
  createUser,
  currentEmployment,
  resetDb,
  signToken,
} from '../../../__tests__/helpers/factories';

// Managing employees is an HR-only capability, so these go through the full middleware chain
// rather than calling the service directly.
const API = '/api/v1/employees';

// fullTimeSince is derived from "today" on a part-time → full-time conversion, so now is
// pinned. Only Date is faked — timers stay real so Prisma's async I/O still resolves.
const NOW = new Date('2026-07-15T12:00:00.000Z');

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  await resetDb();
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function hrToken(): Promise<string> {
  const hr = await createUser({ roleName: 'HR' });
  return signToken(hr);
}

function fullTimePayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Test Person',
    joinDate: '2025-01-06T00:00:00.000Z',
    position: 'Engineer',
    employmentType: 'FULL_TIME',
    monthlySalary: 10_000_000,
    ...overrides,
  };
}

function partTimePayload(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Test Person',
    joinDate: '2025-01-06T00:00:00.000Z',
    position: 'Engineer',
    employmentType: 'PART_TIME',
    hourlyRate: 50_000,
    ...overrides,
  };
}

function isoDay(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

describe('employee routes — authorization', () => {
  it('rejects an unauthenticated create with 401', async () => {
    const res = await request(app).post(API).send(fullTimePayload());
    expect(res.status).toBe(401);
  });

  it('forbids a non-HR employee from creating an employee (403)', async () => {
    const user = await createUser({ roleName: 'EMPLOYEE' });
    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${signToken(user)}`)
      .send(fullTimePayload());
    expect(res.status).toBe(403);

    const stored = await prisma.employee.count();
    expect(stored).toBe(0);
  });
});

describe('employee routes — fullTimeSince anchor on create', () => {
  it('anchors a new full-timer at their join date', async () => {
    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload());
    expect(res.status).toBe(201);

    const stored = await currentEmployment(res.body.id);
    expect(isoDay(stored.fullTimeSince)).toBe('2025-01-06');
  });

  it('leaves a new part-timer with no anchor', async () => {
    const res = await request(app)
      .post(API)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(partTimePayload());
    expect(res.status).toBe(201);

    const stored = await currentEmployment(res.body.id);
    expect(stored.fullTimeSince).toBeNull();
  });
});

describe('employee routes — fullTimeSince anchor on employment type change', () => {
  it('anchors at today when converting part-time → full-time', async () => {
    const employee = await createEmployee({
      employmentType: 'PART_TIME',
      joinDate: new Date('2025-01-06T00:00:00.000Z'),
    });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload());
    expect(res.status).toBe(200);

    const stored = await currentEmployment(employee.id);
    // Today, not the join date — they did not earn leave while part-time.
    expect(isoDay(stored.fullTimeSince)).toBe('2026-07-15');
  });

  it('clears the anchor when converting full-time → part-time', async () => {
    const employee = await createEmployee({ joinDate: new Date('2025-01-06T00:00:00.000Z') });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(partTimePayload());
    expect(res.status).toBe(200);

    const stored = await currentEmployment(employee.id);
    expect(stored.fullTimeSince).toBeNull();
  });

  it('preserves the anchor on an update that does not change employment type', async () => {
    const employee = await createEmployee({
      joinDate: new Date('2025-01-06T00:00:00.000Z'),
      fullTimeSince: new Date('2026-03-01T00:00:00.000Z'),
    });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload({ position: 'Senior Engineer' }));
    expect(res.status).toBe(200);

    // The anchor lives on the employment; position is still an employee field.
    const employment = await currentEmployment(employee.id);
    // The blind buildData overwrite must not reset this to the employment start date.
    expect(isoDay(employment.fullTimeSince)).toBe('2026-03-01');

    const stored = await prisma.employee.findUniqueOrThrow({ where: { id: employee.id } });
    expect(stored.position).toBe('Senior Engineer');
  });

  it('honours an explicitly supplied anchor over the transition default', async () => {
    const employee = await createEmployee({
      employmentType: 'PART_TIME',
      joinDate: new Date('2025-01-06T00:00:00.000Z'),
    });

    // HR correcting a conversion that took effect on 1 June but is only being entered now.
    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload({ fullTimeSince: '2026-06-01T00:00:00.000Z' }));
    expect(res.status).toBe(200);

    const stored = await currentEmployment(employee.id);
    expect(isoDay(stored.fullTimeSince)).toBe('2026-06-01');
  });

  // The accrual generator takes startOf('month') in server-local time, so an anchor carrying a
  // time component can land in the wrong month: a UTC+7 client sending local midnight as an ISO
  // string yields the PREVIOUS day in UTC, and on a UTC server that anchors a whole month early,
  // granting a spurious paid-leave day. The anchor must be stored at UTC midnight.
  it('normalizes a supplied anchor to UTC midnight', async () => {
    const employee = await createEmployee({
      employmentType: 'PART_TIME',
      joinDate: new Date('2025-01-06T00:00:00.000Z'),
    });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload({ fullTimeSince: '2026-06-01T17:30:00.000Z' }));
    expect(res.status).toBe(200);

    const stored = await currentEmployment(employee.id);
    expect(stored.fullTimeSince?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('accepts a plain calendar-day string as the anchor', async () => {
    const employee = await createEmployee({
      employmentType: 'PART_TIME',
      joinDate: new Date('2025-01-06T00:00:00.000Z'),
    });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(fullTimePayload({ fullTimeSince: '2026-06-01' }));
    expect(res.status).toBe(200);

    const stored = await currentEmployment(employee.id);
    expect(stored.fullTimeSince?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('ignores an anchor supplied for a part-timer', async () => {
    const employee = await createEmployee({ joinDate: new Date('2025-01-06T00:00:00.000Z') });

    const res = await request(app)
      .put(`${API}/${employee.id}`)
      .set('Authorization', `Bearer ${await hrToken()}`)
      .send(partTimePayload({ fullTimeSince: '2026-06-01T00:00:00.000Z' }));
    expect(res.status).toBe(200);

    // Assert on stored state: a part-timer must never carry an accrual anchor, whatever the
    // request body said.
    const stored = await currentEmployment(employee.id);
    expect(stored.fullTimeSince).toBeNull();
  });
});
