import type { Request, Response, NextFunction } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { requireRole } from '../rbac';
import { HttpError } from '../../lib/httpError';
import type { AuthUser } from '../auth';

// requireRole is pure (it only reads req.user), so it is exercised directly
// rather than through an HTTP round-trip.
function run(user: AuthUser | undefined, ...roles: string[]) {
  const req = { user } as Request;
  const next = vi.fn() as unknown as NextFunction;
  const invoke = () => requireRole(...roles)(req, {} as Response, next);
  return { invoke, next: next as unknown as ReturnType<typeof vi.fn> };
}

const hr: AuthUser = { userId: 1, roleName: 'HR', employeeId: null };
const employee: AuthUser = { userId: 2, roleName: 'EMPLOYEE', employeeId: 7 };

describe('requireRole', () => {
  it('calls next() when the role matches', () => {
    const { invoke, next } = run(hr, 'HR');
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it('accepts any of several permitted roles', () => {
    const { invoke, next } = run(employee, 'HR', 'EMPLOYEE');
    invoke();
    expect(next).toHaveBeenCalledOnce();
  });

  it('throws 403 when the role is not permitted', () => {
    const { invoke, next } = run(employee, 'HR');
    expect(invoke).toThrowError(
      expect.objectContaining({ status: 403, message: 'Insufficient permissions' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 401 rather than 403 when no user is attached', () => {
    // A 403 here would wrongly tell an anonymous caller the route exists for them.
    const { invoke, next } = run(undefined, 'HR');
    expect(invoke).toThrowError(expect.objectContaining({ status: 401 }));
    expect(next).not.toHaveBeenCalled();
  });

  it('matches role names case-sensitively', () => {
    // Role.name is stored uppercase; a lowercase token value must not slip through.
    const { invoke } = run({ ...hr, roleName: 'hr' }, 'HR');
    expect(invoke).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('denies everyone when the permitted-role list is empty', () => {
    const { invoke } = run(hr);
    expect(invoke).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('throws HttpError so errorHandler maps it instead of returning a 500', () => {
    const { invoke } = run(employee, 'HR');
    expect(invoke).toThrowError(HttpError);
  });
});
