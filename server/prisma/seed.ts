import { PrismaClient, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

// UTC date helper so seeded @db.Date values are stable regardless of machine TZ.
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

// One accrual row per completed month from joinDate through July 2026,
// each expiring 18 months after its accrual period (design §3 / §4).
function buildAccruals(employeeId: number, joinDate: string): Prisma.LeaveAccrualCreateManyInput[] {
  const rows: Prisma.LeaveAccrualCreateManyInput[] = [];
  const last = dayjs('2026-07-01');
  let cursor = dayjs(joinDate).startOf('month');
  while (cursor.isSame(last) || cursor.isBefore(last)) {
    rows.push({
      employeeId,
      period: d(cursor.format('YYYY-MM-DD')),
      days: 1,
      daysConsumed: 0,
      expiresAt: d(cursor.add(18, 'month').format('YYYY-MM-DD')),
    });
    cursor = cursor.add(1, 'month');
  }
  return rows;
}

// Mirrors the FIFO draw the service performs when paid leave is recorded, so the seeded
// balance matches the seeded leave: oldest-expiring non-expired rows first (design §4).
async function consumeAccruals(employeeId: number, days: number): Promise<void> {
  const accruals = await prisma.leaveAccrual.findMany({
    where: { employeeId, expiresAt: { gt: new Date() } },
    orderBy: [{ expiresAt: 'asc' }, { period: 'asc' }],
  });
  let remaining = days;
  for (const accrual of accruals) {
    if (remaining <= 0) break;
    const take = Math.min(Number(accrual.days) - Number(accrual.daysConsumed), remaining);
    if (take <= 0) continue;
    await prisma.leaveAccrual.update({
      where: { id: accrual.id },
      data: { daysConsumed: { increment: take } },
    });
    remaining -= take;
  }
}

// 2026 Indonesian national holidays + Eid cuti bersama (JOINT_LEAVE).
// Lunar/movable-feast dates are the official-approximate values used for UAT.
const holidays: Prisma.HolidayCreateManyInput[] = [
  { name: 'Tahun Baru Masehi (New Year)', date: d('2026-01-01'), type: 'NATIONAL' },
  { name: 'Isra Mikraj Nabi Muhammad SAW', date: d('2026-01-16'), type: 'NATIONAL' },
  { name: 'Tahun Baru Imlek (Chinese New Year)', date: d('2026-02-17'), type: 'NATIONAL' },
  { name: 'Cuti Bersama Imlek', date: d('2026-02-18'), type: 'JOINT_LEAVE' },
  { name: 'Hari Suci Nyepi (Saka New Year)', date: d('2026-03-19'), type: 'NATIONAL' },
  { name: 'Hari Raya Idul Fitri 1447 H (Day 1)', date: d('2026-03-20'), type: 'NATIONAL' },
  { name: 'Hari Raya Idul Fitri 1447 H (Day 2)', date: d('2026-03-21'), type: 'NATIONAL' },
  { name: 'Cuti Bersama Idul Fitri', date: d('2026-03-23'), type: 'JOINT_LEAVE' },
  { name: 'Cuti Bersama Idul Fitri', date: d('2026-03-24'), type: 'JOINT_LEAVE' },
  { name: 'Cuti Bersama Idul Fitri', date: d('2026-03-25'), type: 'JOINT_LEAVE' },
  { name: 'Wafat Isa Almasih (Good Friday)', date: d('2026-04-03'), type: 'NATIONAL' },
  { name: 'Hari Buruh (Labor Day)', date: d('2026-05-01'), type: 'NATIONAL' },
  { name: 'Kenaikan Isa Almasih (Ascension)', date: d('2026-05-14'), type: 'NATIONAL' },
  { name: 'Hari Raya Idul Adha 1447 H', date: d('2026-05-27'), type: 'NATIONAL' },
  { name: 'Hari Raya Waisak 2570', date: d('2026-05-31'), type: 'NATIONAL' },
  { name: 'Hari Lahir Pancasila (Pancasila Day)', date: d('2026-06-01'), type: 'NATIONAL' },
  { name: 'Tahun Baru Islam 1448 H (Islamic New Year)', date: d('2026-06-16'), type: 'NATIONAL' },
  { name: 'Hari Kemerdekaan (Independence Day)', date: d('2026-08-17'), type: 'NATIONAL' },
  { name: 'Maulid Nabi Muhammad SAW', date: d('2026-08-25'), type: 'NATIONAL' },
  { name: 'Hari Raya Natal (Christmas)', date: d('2026-12-25'), type: 'NATIONAL' },
];

async function main() {
  // Idempotent: clear transactional + reference data in FK-safe order, then recreate.
  await prisma.payslip.deleteMany();
  await prisma.payrollPeriod.deleteMany();
  await prisma.reimbursement.deleteMany();
  await prisma.overtime.deleteMany();
  await prisma.dailyLog.deleteMany();
  await prisma.leaveRequest.deleteMany();
  await prisma.leaveAccrual.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.user.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.role.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  const hrRole = await prisma.role.create({ data: { name: 'HR' } });
  const employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE' } });

  // The single HR-role account (no employee profile).
  const hrUser = await prisma.user.create({
    data: { email: 'hr@aisahub.com', passwordHash, roleId: hrRole.id },
  });

  // Full-time employees (monthly salary, THR-eligible, complete profiles) with linked user accounts.
  const budi = await prisma.employee.create({
    data: {
      fullName: 'Budi Santoso',
      nickname: 'Budi',
      joinDate: d('2024-03-01'),
      position: 'Backend Engineer',
      employmentType: 'FULL_TIME',
      fullTimeSince: d('2024-03-01'),
      contractStartDate: d('2024-03-01'),
      contractEndDate: d('2027-02-28'),
      monthlySalary: 10_000_000,
      email: 'budi@aisahub.com',
      university: 'Universitas Indonesia',
      major: 'Computer Science',
      graduationYear: 2020,
      linkedinUrl: 'https://www.linkedin.com/in/budi-santoso',
      religion: 'Islam',
      thrEligible: true,
      bankName: 'BCA',
      bankAccountNumber: '1234567890',
      ktpNumber: '3171010101010001',
      phoneNumber: '+6281234567001',
      user: { create: { email: 'budi@aisahub.com', passwordHash, roleId: employeeRole.id } },
    },
  });

  const sari = await prisma.employee.create({
    data: {
      fullName: 'Sari Wulandari',
      nickname: 'Sari',
      joinDate: d('2025-01-06'),
      position: 'Frontend Engineer',
      employmentType: 'FULL_TIME',
      fullTimeSince: d('2025-01-06'),
      contractStartDate: d('2025-01-06'),
      contractEndDate: d('2028-01-05'),
      monthlySalary: 12_000_000,
      email: 'sari@aisahub.com',
      university: 'Institut Teknologi Bandung',
      major: 'Informatics',
      graduationYear: 2021,
      linkedinUrl: 'https://www.linkedin.com/in/sari-wulandari',
      religion: 'Islam',
      thrEligible: true,
      bankName: 'Mandiri',
      bankAccountNumber: '0987654321',
      ktpNumber: '3171020202020002',
      phoneNumber: '+6281234567002',
      user: { create: { email: 'sari@aisahub.com', passwordHash, roleId: employeeRole.id } },
    },
  });

  // Part-time employees (hourly rate, daily activity logging) with linked user accounts.
  const andi = await prisma.employee.create({
    data: {
      fullName: 'Andi Pratama',
      nickname: 'Andi',
      joinDate: d('2025-09-01'),
      position: 'Part-time Web Developer',
      employmentType: 'PART_TIME',
      contractStartDate: d('2025-09-01'),
      contractEndDate: d('2026-08-31'),
      hourlyRate: 50_000,
      email: 'andi@aisahub.com',
      university: 'Universitas Gadjah Mada',
      major: 'Information Systems',
      graduationYear: 2024,
      religion: 'Islam',
      thrEligible: false,
      bankName: 'BNI',
      bankAccountNumber: '1122334455',
      ktpNumber: '3171030303030003',
      phoneNumber: '+6281234567003',
      user: { create: { email: 'andi@aisahub.com', passwordHash, roleId: employeeRole.id } },
    },
  });

  const dewi = await prisma.employee.create({
    data: {
      fullName: 'Dewi Lestari',
      nickname: 'Dewi',
      joinDate: d('2025-10-15'),
      position: 'Part-time UI Designer',
      employmentType: 'PART_TIME',
      contractStartDate: d('2025-10-15'),
      contractEndDate: d('2026-10-14'),
      hourlyRate: 60_000,
      email: 'dewi@aisahub.com',
      university: 'Universitas Padjadjaran',
      major: 'Visual Communication Design',
      graduationYear: 2023,
      religion: 'Kristen',
      thrEligible: false,
      bankName: 'BRI',
      bankAccountNumber: '5566778899',
      ktpNumber: '3171040404040004',
      phoneNumber: '+6281234567004',
      user: { create: { email: 'dewi@aisahub.com', passwordHash, roleId: employeeRole.id } },
    },
  });

  await prisma.holiday.createMany({ data: holidays });

  await prisma.leaveAccrual.createMany({
    data: [...buildAccruals(budi.id, '2024-03-01'), ...buildAccruals(sari.id, '2025-01-06')],
  });

  // Sample daily logs for part-timers (June/July 2026).
  await prisma.dailyLog.createMany({
    data: [
      { employeeId: andi.id, date: d('2026-06-02'), hours: 8, project: 'Website Revamp', notes: 'Landing page' },
      { employeeId: andi.id, date: d('2026-06-03'), hours: 7.5, project: 'Website Revamp' },
      { employeeId: andi.id, date: d('2026-07-01'), hours: 8, project: 'Mobile App' },
      { employeeId: dewi.id, date: d('2026-06-02'), hours: 8, project: 'Design System' },
      { employeeId: dewi.id, date: d('2026-07-02'), hours: 6, project: 'Design System', notes: 'Icon set' },
    ],
  });

  // Overtime: one approved, one pending (full-timers only).
  await prisma.overtime.create({
    data: {
      employeeId: budi.id,
      date: d('2026-06-10'),
      hours: 3,
      description: 'Production hotfix',
      status: 'APPROVED',
      reviewedById: hrUser.id,
      reviewedAt: d('2026-06-11'),
    },
  });
  await prisma.overtime.create({
    data: {
      employeeId: sari.id,
      date: d('2026-07-03'),
      hours: 2,
      description: 'Release preparation',
      status: 'PENDING',
    },
  });

  // Leave: one SICK and one UNPAID (neither touches accrual; both deduct salary), one PAID.
  // Leave is taken the moment it is recorded, so the paid one draws its days from the accrual
  // pool below. The two deducting records share June 2026 so the seeded draft payroll period
  // exercises a payslip with both deduction lines.
  await prisma.leaveRequest.create({
    data: {
      employeeId: budi.id,
      type: 'SICK',
      startDate: d('2026-06-15'),
      endDate: d('2026-06-16'),
      totalDays: 2,
      reason: 'Flu',
    },
  });
  await prisma.leaveRequest.create({
    data: {
      employeeId: budi.id,
      type: 'UNPAID',
      startDate: d('2026-06-22'),
      endDate: d('2026-06-23'),
      totalDays: 2,
      reason: 'Personal matters, balance already used',
    },
  });
  await prisma.leaveRequest.create({
    data: {
      employeeId: sari.id,
      type: 'PAID',
      startDate: d('2026-07-20'),
      endDate: d('2026-07-22'),
      totalDays: 3,
      reason: 'Family vacation',
    },
  });
  await consumeAccruals(sari.id, 3);

  // Pending reimbursement.
  await prisma.reimbursement.create({
    data: {
      employeeId: budi.id,
      date: d('2026-07-01'),
      amount: 350_000,
      description: 'Client meeting lunch',
      status: 'PENDING',
    },
  });

  // One DRAFT payroll period for June 2026 (design §8 seed fixture; payslips are created on finalize).
  await prisma.payrollPeriod.create({
    data: { year: 2026, month: 6, exchangeRate: 16_250, rateSource: 'FALLBACK', status: 'DRAFT' },
  });

  console.log('Seed complete: 2 roles, 5 users, 4 employees, 20 holidays, sample data.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
