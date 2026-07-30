import { resolveTestDatabaseUrl } from './testDatabase';

// Runs before each test file's module graph is imported, so src/config/env.ts
// (and the PrismaClient it feeds) pick up the test database rather than the one
// in .env — dotenv.config() leaves already-set variables alone.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
// Keep Nodemailer from attempting a real connection if a suite forgets to mock it.
process.env.SMTP_HOST = '';
