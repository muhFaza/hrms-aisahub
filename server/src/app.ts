import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRoutes } from './modules/auth/routes';
import { usersRoutes } from './modules/users/routes';
import { employeesRoutes } from './modules/employees/routes';
import { holidaysRoutes } from './modules/holidays/routes';
import { leaveRoutes } from './modules/leave/routes';
import { dailyLogsRoutes } from './modules/daily-logs/routes';
import { overtimeRoutes } from './modules/overtime/routes';
import { reimbursementsRoutes } from './modules/reimbursements/routes';
import { payrollRoutes } from './modules/payroll/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { notificationsRoutes } from './modules/notifications/routes';

// Express app assembled here (no listen) so it can be imported by both the server
// entrypoint (index.ts) and the supertest API smoke tests (Phase 6).
export const app = express();

// In production the client is served from this same origin (behind Traefik), so
// cross-origin requests are never legitimate. Locally, Vite runs on :5173 and
// needs CORS to reach the API on :5000.
if (env.nodeEnv !== 'production') {
  app.use(cors());
}
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public: /auth/login. Everything else (incl. /auth/me) requires a valid JWT.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', authenticate, usersRoutes);
app.use('/api/v1/employees', authenticate, employeesRoutes);
app.use('/api/v1/holidays', authenticate, holidaysRoutes);
app.use('/api/v1/leave', authenticate, leaveRoutes);
app.use('/api/v1/daily-logs', authenticate, dailyLogsRoutes);
app.use('/api/v1/overtime', authenticate, overtimeRoutes);
app.use('/api/v1/reimbursements', authenticate, reimbursementsRoutes);
app.use('/api/v1/payroll', authenticate, payrollRoutes);
app.use('/api/v1/dashboard', authenticate, dashboardRoutes);
app.use('/api/v1/notifications', authenticate, notificationsRoutes);

// Container-only (SERVE_CLIENT=true): serve the built SPA from this same origin.
// Registered after every /api/v1 route so unknown API paths still fall through to
// notFoundHandler's JSON 404 rather than being answered with index.html.
if (env.serveClient) {
  const indexHtml = path.join(env.clientDist, 'index.html');

  app.use(express.static(env.clientDist, { index: false }));

  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(indexHtml);
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
