import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../app';

// GET /api/v1/config is the only public endpoint besides /health and /auth/login.
// It exists so one image can serve both the demo and the live instance: the login
// page reads demoMode before anyone has a token. These tests pin both halves of
// that — the value tracks the environment variable, and no token is needed.
describe('GET /api/v1/config', () => {
  const original = process.env.DEMO_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEMO_MODE;
    } else {
      process.env.DEMO_MODE = original;
    }
  });

  afterAll(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
  });

  it('reports demoMode true when DEMO_MODE is "true"', async () => {
    process.env.DEMO_MODE = 'true';

    const res = await request(app).get('/api/v1/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demoMode: true });
  });

  it('reports demoMode false when DEMO_MODE is unset', async () => {
    delete process.env.DEMO_MODE;

    const res = await request(app).get('/api/v1/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ demoMode: false });
  });

  it('reports demoMode false when DEMO_MODE is "false"', async () => {
    process.env.DEMO_MODE = 'false';

    const res = await request(app).get('/api/v1/config');

    expect(res.body).toEqual({ demoMode: false });
  });

  // Anything other than the exact string is off: a typo must not expose the demo
  // account list, complete with its shared password, on the live instance.
  it('reports demoMode false for a near-miss value', async () => {
    process.env.DEMO_MODE = 'TRUE';

    const res = await request(app).get('/api/v1/config');

    expect(res.body).toEqual({ demoMode: false });
  });

  it('is reachable without an Authorization header', async () => {
    const res = await request(app).get('/api/v1/config').set('Authorization', '');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('demoMode');
  });
});
