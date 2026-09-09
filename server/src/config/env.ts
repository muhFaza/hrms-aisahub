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
  // Demo instance flag, surfaced to the client by GET /api/v1/config.
  //
  // A getter, not a captured value: one image serves both the demo and the live
  // instance, so this can only ever be a runtime read. Anything baked at import
  // (or at build) would be wrong for one of the two. Exactly "true" enables it —
  // a typo leaves the demo widgets hidden, which is the safe direction on an
  // instance holding real salaries.
  get demoMode(): boolean {
    return process.env.DEMO_MODE === 'true';
  },
};
