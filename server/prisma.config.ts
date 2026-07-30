// Prisma CLI config — replaces the deprecated `package.json#prisma` field,
// which Prisma 7 removes. See https://pris.ly/prisma-config
//
// Note: when a prisma.config.ts is present, the Prisma CLI no longer loads
// .env files automatically, so we load them here (mirrors src/config/env.ts).
import 'dotenv/config';

import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
});
