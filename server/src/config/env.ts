import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  // Container-only: serve the built client from Express so API and UI share an
  // origin behind Traefik. Unset locally, where Vite serves the client on :5173.
  serveClient: process.env.SERVE_CLIENT === 'true',
  clientDist: process.env.CLIENT_DIST ?? path.resolve(process.cwd(), 'client-dist'),
  // Overridable so the container can point at a mounted volume instead of cwd.
  uploadDir: process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), 'uploads'),
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'HRMS Aisahub <no-reply@aisahub.com>',
  },
  ownerEmail: process.env.OWNER_EMAIL ?? 'owner@aisahub.com',
};
