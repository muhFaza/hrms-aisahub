/**
 * Demo dataset generator — see docs/superpowers/specs/2026-08-06-demo-data-design.md
 *
 * Lays down a coherent demo dataset for the 5-minute walkthrough video by driving the
 * live HTTP API, not by writing SQL. That is deliberate: accrual FIFO consumption, the
 * leave overlap check, assertEmployed, the period-range lock, notification fan-out and
 * payslip computation all run for real, so nothing exists in a shape the app itself
 * would never produce.
 *
 * Expects a database already reset to baseline (see the spec, Part 1) — it refuses to
 * run if any payroll period already exists.
 *
 *   pnpm --filter server exec tsx ../scripts/demo-data.ts --base-url http://localhost:5055
 *
 * Flags:
 *   --base-url <url>   API origin (default http://localhost:5055)
 *   --today <date>     Override "today" for the current-activity window (default: real today, UTC)
 *   --force            Run even if payroll periods already exist
 */

const args = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const BASE_URL = (flag('base-url') ?? 'http://localhost:5055').replace(/\/$/, '');
const API = `${BASE_URL}/api/v1`;
const FORCE = args.includes('--force');
const PASSWORD = 'password123';

const TODAY = flag('today') ?? new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Windows. Anchored on the shipped 26–25 payroll cutoff.
// ---------------------------------------------------------------------------

const JUNE = { start: '2026-05-26', end: '2026-06-25' };
const JULY = { start: '2026-06-26', end: '2026-07-25' };
const CURRENT = { start: '2026-07-26', end: TODAY };

// Off-day holidays inside the windows: the two seeded June nationals plus the
// COMPANY day this script adds. Daily logs skip them.
const OFF_DAYS = new Set(['2026-06-01', '2026-06-16', '2026-07-10']);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

type Session = { token: string; employeeId: number | null; name: string };

async function req<T = any>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload: any;
  if (body instanceof FormData) {
    payload = body; // fetch sets the multipart boundary itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${API}${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}\n  ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function login(email: string): Promise<Session> {
  const out = await req<{ token: string; user: { employee: { id: number } | null } }>(
    null,
    'POST',
    '/auth/login',
    { email, password: PASSWORD },
  );
  return {
    token: out.token,
    employeeId: out.user.employee?.id ?? null,
    name: email.split('@')[0],
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** UTC day-of-week, 0=Sun … 6=Sat. All date arithmetic here is UTC, per the codebase rule. */
function dow(iso: string): number {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay();
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dates in [start, end] falling on the given weekdays, minus off-day holidays. */
function weekdaysIn(start: string, end: string, weekdays: number[]): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (weekdays.includes(dow(d)) && !OFF_DAYS.has(d)) out.push(d);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evidence PDFs — real, valid, one-page files so the download button works on camera.
// ---------------------------------------------------------------------------

function makePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/([\\()])/g, '\\$1');
  const content =
    `BT\n/F1 16 Tf\n72 780 Td\n(${esc(title)}) Tj\n/F1 11 Tf\n` +
    lines.map((l, i) => `0 -${i === 0 ? 32 : 18} Td\n(${esc(l)}) Tj\n`).join('') +
    `ET\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

const rupiah = (n: number) => `Rp ${n.toLocaleString('en-US')}`;

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

let created = {
  leave: 0,
  overtime: 0,
  dailyLogs: 0,
  reimbursements: 0,
  holidays: 0,
  periods: 0,
};

async function submitLeave(
  who: Session,
  type: 'PAID' | 'SICK' | 'UNPAID',
  startDate: string,
  endDate: string,
  reason: string,
) {
  await req(who.token, 'POST', '/leave', { type, startDate, endDate, reason });
  created.leave++;
  console.log(`  leave      ${who.name.padEnd(5)} ${type.padEnd(6)} ${startDate} → ${endDate}`);
}

async function submitOvertime(
  hr: Session,
  who: Session,
  date: string,
  hours: number,
  description: string,
  decision: 'APPROVE' | 'REJECT' | 'PENDING',
  rejectReason?: string,
) {
  const ot = await req<{ id: number }>(who.token, 'POST', '/overtime', {
    date,
    hours,
    description,
  });
  created.overtime++;
  if (decision !== 'PENDING') {
    await req(hr.token, 'PATCH', `/overtime/${ot.id}/review`, {
      action: decision,
      rejectReason: decision === 'REJECT' ? rejectReason : undefined,
    });
  }
  console.log(`  overtime   ${who.name.padEnd(5)} ${date} ${String(hours).padStart(4)}h ${decision}`);
}

async function submitReimbursement(
  hr: Session,
  who: Session,
  date: string,
  amount: number,
  description: string,
  decision: 'APPROVE' | 'REJECT' | 'PENDING',
  rejectReason?: string,
) {
  const pdf = makePdf('RECEIPT / KWITANSI', [
    `Date        : ${date}`,
    `Amount      : ${rupiah(amount)}`,
    `Description : ${description}`,
    `Employee    : ${who.name}`,
    '',
    'Aisahub Inc. — demo evidence document.',
  ]);

  const fd = new FormData();
  fd.set('date', date);
  fd.set('amount', String(amount));
  fd.set('description', description);
  fd.set(
    'evidence',
    new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
    `receipt-${date}-${who.name}.pdf`,
  );

  const r = await req<{ id: number }>(who.token, 'POST', '/reimbursements', fd);
  created.reimbursements++;
  if (decision !== 'PENDING') {
    await req(hr.token, 'PATCH', `/reimbursements/${r.id}/review`, {
      action: decision,
      rejectReason: decision === 'REJECT' ? rejectReason : undefined,
    });
  }
  console.log(
    `  reimb      ${who.name.padEnd(5)} ${date} ${rupiah(amount).padStart(13)} ${decision}`,
  );
}

/** Part-timers log a fixed weekly shape, so the data is realistic and deterministic. */
const LOG_SHAPE: Record<string, { weekdays: number[]; hours: Record<number, number> }> = {
  andi: { weekdays: [1, 2, 3, 4], hours: { 1: 8, 2: 8, 3: 7.5, 4: 6 } },
  dewi: { weekdays: [2, 3, 4], hours: { 2: 6, 3: 7, 4: 5 } },
};

async function logDays(who: Session, window: { start: string; end: string }, project: string) {
  const shape = LOG_SHAPE[who.name];
  const dates = weekdaysIn(window.start, window.end, shape.weekdays);
  for (const date of dates) {
    await req(who.token, 'POST', '/daily-logs', {
      date,
      hours: shape.hours[dow(date)],
      project,
      notes: dow(date) === 1 ? 'Sprint planning and setup' : undefined,
    });
    created.dailyLogs++;
  }
  console.log(`  daily logs ${who.name.padEnd(5)} ${dates.length} days on ${project}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\nHRMS demo data → ${BASE_URL}`);
  console.log(`Windows: June ${JUNE.start}…${JUNE.end} | July ${JULY.start}…${JULY.end} | current ${CURRENT.start}…${CURRENT.end}\n`);

  await req(null, 'GET', '/health');

  const hr = await login('hr@aisahub.com');
  const budi = await login('budi@aisahub.com');
  const sari = await login('sari@aisahub.com');
  const andi = await login('andi@aisahub.com');
  const dewi = await login('dewi@aisahub.com');
  console.log('Logged in: hr, budi, sari, andi, dewi');

  // Refuse to append to a database that has not been reset — periods are the tell.
  const periodsRes = await req<any>(hr.token, 'GET', '/payroll/periods');
  const existing = Array.isArray(periodsRes) ? periodsRes : (periodsRes?.data ?? []);
  if (existing.length > 0 && !FORCE) {
    throw new Error(
      `Database is not at baseline: ${existing.length} payroll period(s) already exist. ` +
        `Run the reset first (see the spec), or pass --force.`,
    );
  }

  // --- Holiday -------------------------------------------------------------
  console.log('\n[1/6] Holiday');
  await req(hr.token, 'POST', '/holidays', {
    name: 'Aisahub Company Outing',
    date: '2026-07-10',
    type: 'COMPANY',
    notes: 'Annual team outing — office closed',
  });
  created.holidays++;
  console.log('  holiday    Aisahub Company Outing 2026-07-10 (COMPANY)');

  // --- June window (must be complete before June is finalized) --------------
  console.log(`\n[2/6] June window ${JUNE.start} → ${JUNE.end}`);
  await submitLeave(budi, 'SICK', '2026-06-08', '2026-06-09', 'Flu, doctor advised rest');
  await submitLeave(sari, 'PAID', '2026-06-11', '2026-06-12', 'Family matters');
  await submitOvertime(hr, budi, '2026-06-03', 3, 'Production hotfix for payment webhook', 'APPROVE');
  await submitOvertime(hr, sari, '2026-06-18', 2, 'Release preparation and smoke testing', 'APPROVE');
  await logDays(andi, JUNE, 'Website Revamp');
  await logDays(dewi, JUNE, 'Design System');
  await submitReimbursement(hr, budi, '2026-06-04', 350_000, 'Client meeting lunch', 'APPROVE');
  await submitReimbursement(hr, dewi, '2026-06-15', 150_000, 'Stock illustration licence', 'APPROVE');

  // --- July window (draft period — nothing is locked) -----------------------
  console.log(`\n[3/6] July window ${JULY.start} → ${JULY.end}`);
  await submitLeave(sari, 'SICK', '2026-06-29', '2026-06-30', 'Migraine');
  await submitLeave(budi, 'PAID', '2026-07-06', '2026-07-08', 'Annual leave — short trip');
  await submitLeave(sari, 'UNPAID', '2026-07-13', '2026-07-14', 'Personal matters, balance already used');
  await submitOvertime(hr, budi, '2026-07-02', 3, 'Database migration window', 'APPROVE');
  await submitOvertime(hr, sari, '2026-07-09', 4, 'Dashboard redesign delivery', 'APPROVE');
  await submitOvertime(hr, budi, '2026-07-14', 2.5, 'Incident response — API latency', 'APPROVE');
  await submitOvertime(
    hr, sari, '2026-07-21', 2, 'Extra QA pass', 'REJECT',
    'Work fits within normal hours — please re-plan the sprint instead',
  );
  await logDays(andi, JULY, 'Mobile App');
  await logDays(dewi, JULY, 'Marketing Site');
  await submitReimbursement(hr, budi, '2026-07-02', 275_000, 'Transport to client office', 'APPROVE');
  await submitReimbursement(hr, sari, '2026-07-07', 1_200_000, 'JSConf Asia conference ticket', 'APPROVE');
  await submitReimbursement(hr, andi, '2026-07-15', 180_000, 'Co-working space day pass', 'APPROVE');
  await submitReimbursement(
    hr, dewi, '2026-07-20', 450_000, 'Figma team seat', 'REJECT',
    'Already covered by the company subscription',
  );

  // --- Current window ------------------------------------------------------
  console.log(`\n[4/6] Current window ${CURRENT.start} → ${CURRENT.end}`);
  await submitLeave(sari, 'SICK', '2026-08-03', '2026-08-04', 'Fever');
  await submitLeave(budi, 'PAID', '2026-08-10', '2026-08-12', 'Annual leave — family visit');
  await logDays(andi, CURRENT, 'Mobile App');
  await logDays(dewi, CURRENT, 'Marketing Site');

  // --- Payroll -------------------------------------------------------------
  console.log('\n[5/6] Payroll');
  const june = await req<{ id: number }>(hr.token, 'POST', '/payroll/periods', {
    year: 2026, month: 6, startDate: JUNE.start, endDate: JUNE.end,
  });
  created.periods++;
  await req(hr.token, 'POST', `/payroll/periods/${june.id}/finalize`);
  console.log(`  period     June 2026 ${JUNE.start} → ${JUNE.end} FINALIZED`);

  const july = await req<{ id: number }>(hr.token, 'POST', '/payroll/periods', {
    year: 2026, month: 7, startDate: JULY.start, endDate: JULY.end,
  });
  created.periods++;
  console.log(`  period     July 2026 ${JULY.start} → ${JULY.end} DRAFT (finalize on camera)`);

  // --- Pending queue, created last so HR's badge shows exactly these --------
  console.log('\n[6/6] Inbox');
  const readAll = await req<{ updated: number }>(hr.token, 'POST', '/notifications/read-all');
  console.log(`  hr read-all (${readAll.updated} marked read)`);

  await submitOvertime(hr, budi, '2026-07-30', 3, 'Peak-load monitoring after release', 'PENDING');
  await submitOvertime(hr, sari, '2026-08-05', 2, 'Design review with the Seoul team', 'PENDING');
  await submitReimbursement(hr, sari, '2026-07-29', 600_000, 'Team dinner after release', 'PENDING');
  await submitReimbursement(hr, andi, '2026-08-03', 95_000, 'Transport to client office', 'PENDING');

  // --- Report --------------------------------------------------------------
  const unread = await req<{ count: number }>(hr.token, 'GET', '/notifications/unread-count');
  const preview = await req<any>(hr.token, 'GET', `/payroll/periods/${july.id}`);

  console.log('\n─── created ───');
  console.log(`  leave ${created.leave} · overtime ${created.overtime} · daily logs ${created.dailyLogs} · ` +
    `reimbursements ${created.reimbursements} · holidays ${created.holidays} · periods ${created.periods}`);
  console.log(`  HR unread notifications: ${unread.count}`);
  const rows = preview?.payslips ?? preview?.lines ?? preview?.employees ?? [];
  console.log(`  July draft preview: ${Array.isArray(rows) ? rows.length : '?'} employees, status ${preview?.status}`);
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}\n`);
  process.exit(1);
});
