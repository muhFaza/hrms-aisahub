import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// First-boot setup for an instance that must NOT be seeded — the live deployment.
//
// prisma/seed.ts is the only other code that creates the HR and EMPLOYEE roles, and
// it opens with deleteMany() across all 11 tables. So with SEED_ON_START=false a
// fresh database comes up with no roles and no users, and nobody can log in.
//
// This file is the way in. It is deliberately separate from seed.ts: it never
// imports it, and it contains no delete of any kind. Do not add one. On the live
// instance this runs against real payroll data every time the container restarts,
// and the only thing standing between that data and seed.ts is which script the
// entrypoint picks.
//
// Matching seed.ts:105, the HR account gets no Employee record — HR is an operator
// of the system, not somebody it pays.

export interface BootstrapOptions {
  email: string;
  password: string;
}

export interface BootstrapResult {
  rolesCreated: string[];
  userCreated: boolean;
}

const ROLE_NAMES = ['HR', 'EMPLOYEE'] as const;

// Idempotent: safe to run on every container start. Roles are upserted by name;
// the HR user is created only when the database holds no users at all.
export async function bootstrap(
  prisma: PrismaClient,
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  const rolesCreated: string[] = [];

  for (const name of ROLE_NAMES) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (!existing) {
      await prisma.role.create({ data: { name } });
      rolesCreated.push(name);
    }
  }

  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return { rolesCreated, userCreated: false };
  }

  const hrRole = await prisma.role.findUniqueOrThrow({ where: { name: 'HR' } });
  // Cost 10, the same as every other password the application writes.
  const passwordHash = await bcrypt.hash(options.password, 10);
  await prisma.user.create({
    data: { email: options.email, passwordHash, roleId: hrRole.id },
  });

  return { rolesCreated, userCreated: true };
}

// CLI entry — `node dist/prisma/bootstrap.js`, invoked by docker-entrypoint.sh.
async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_HR_EMAIL;
  const password = process.env.BOOTSTRAP_HR_PASSWORD;

  if (!email || !password) {
    console.error(
      '[bootstrap] FATAL: BOOTSTRAP_HR_EMAIL and BOOTSTRAP_HR_PASSWORD must both be set.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const result = await bootstrap(prisma, { email, password });
    if (result.rolesCreated.length > 0) {
      console.log(`[bootstrap] created roles: ${result.rolesCreated.join(', ')}`);
    }
    console.log(
      result.userCreated
        ? `[bootstrap] created the first HR account: ${email}`
        : '[bootstrap] users already exist — leaving accounts untouched.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('[bootstrap] FATAL:', error);
    process.exit(1);
  });
}
