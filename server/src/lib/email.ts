import dayjs from 'dayjs';
import { prisma } from '../config/prisma';
import { mailer } from '../config/mailer';
import { env } from '../config/env';

// Low-level send: never throws — SMTP failures are caught and logged so the API path
// stays unaffected (Nodemailer notifications are fire-and-forget). Phase 5 reuses this
// for payslip emails.
async function sendMail(to: string | string[], subject: string, html: string): Promise<void> {
  const recipients = Array.isArray(to) ? to.filter(Boolean) : to;
  if (Array.isArray(recipients) ? recipients.length === 0 : !recipients) {
    console.warn(`[email] skipped "${subject}" — no recipients`);
    return;
  }
  try {
    await mailer.sendMail({ from: env.smtp.from, to: recipients, subject, html });
    console.log(`[email] sent "${subject}" to ${Array.isArray(recipients) ? recipients.join(', ') : recipients}`);
  } catch (err) {
    console.error(`[email] failed to send "${subject}":`, err instanceof Error ? err.message : err);
  }
}

interface LeaveEmailData {
  employeeName: string;
  type: string;
  startDate: Date;
  endDate: Date;
  totalDays: number | string;
  reason?: string | null;
}

function fmt(date: Date): string {
  return dayjs(date).format('DD MMM YYYY');
}

function leaveDetailsTable(data: LeaveEmailData): string {
  return `
    <table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
      <tr><td style="padding:4px 12px 4px 0;color:#888">Employee</td><td>${data.employeeName}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Type</td><td>${data.type}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Dates</td><td>${fmt(data.startDate)} — ${fmt(data.endDate)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Working days</td><td>${data.totalDays}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#888">Reason</td><td>${data.reason ?? '-'}</td></tr>
    </table>`;
}

// Notifies every active HR-role account when a leave request is submitted.
export async function sendLeaveSubmittedEmail(data: LeaveEmailData): Promise<void> {
  const hrUsers = await prisma.user.findMany({
    where: { isActive: true, role: { name: 'HR' } },
    select: { email: true },
  });
  const recipients = hrUsers.map((user) => user.email);
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333">
      <h2 style="color:#1677ff">New Leave Request</h2>
      <p>A new leave request is awaiting review.</p>
      ${leaveDetailsTable(data)}
    </div>`;
  await sendMail(recipients, `Leave request from ${data.employeeName}`, html);
}

interface PayslipEmailData {
  employeeName: string;
  year: number;
  month: number; // 1-12
  employmentType: 'FULL_TIME' | 'PART_TIME';
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  exchangeRate: number;
  overtimeHours: number;
  dailyLogHours: number;
  sickDays: number;
}

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function monthLabel(year: number, month: number): string {
  return dayjs(new Date(Date.UTC(year, month - 1, 1))).format('MMMM YYYY');
}

function payslipRow(label: string, value: string, negative = false): string {
  const color = negative ? '#ff4d4f' : '#333';
  return `<tr><td style="padding:6px 16px 6px 0;color:#888">${label}</td><td style="text-align:right;color:${color}">${value}</td></tr>`;
}

// Payslip email sent to each employee on finalize. Returns true only when the SMTP send
// succeeds so the caller can stamp Payslip.emailSentAt; never throws (fire-and-forget).
export async function sendPayslipEmail(to: string, data: PayslipEmailData): Promise<boolean> {
  if (!to) {
    console.warn(`[email] skipped payslip for ${data.employeeName} — no email on record`);
    return false;
  }
  const period = monthLabel(data.year, data.month);
  const componentRows =
    data.employmentType === 'FULL_TIME'
      ? [
          payslipRow('Basic salary', idr.format(data.basicSalary)),
          payslipRow(`Overtime (${data.overtimeHours} h)`, idr.format(data.overtimePay)),
          payslipRow('Reimbursements', idr.format(data.reimbursementTotal)),
          payslipRow(`Sick leave (${data.sickDays} day(s))`, `- ${idr.format(data.leaveDeduction)}`, true),
        ].join('')
      : [
          payslipRow(`Activity pay (${data.dailyLogHours} h)`, idr.format(data.basicSalary)),
          payslipRow('Reimbursements', idr.format(data.reimbursementTotal)),
        ].join('');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:520px">
      <h2 style="color:#1677ff;margin-bottom:0">HRMS Aisahub Inc</h2>
      <p style="color:#888;margin-top:4px">Payslip — ${period}</p>
      <p>Dear ${data.employeeName}, here is your payslip for <strong>${period}</strong>.</p>
      <table style="border-collapse:collapse;font-size:14px;width:100%">
        ${componentRows}
        <tr><td colspan="2" style="border-top:1px solid #eee;padding-top:8px"></td></tr>
        <tr><td style="padding:6px 16px 6px 0"><strong>Total (IDR)</strong></td><td style="text-align:right"><strong>${idr.format(data.totalIdr)}</strong></td></tr>
        <tr><td style="padding:6px 16px 6px 0"><strong>Total (USD)</strong></td><td style="text-align:right"><strong>${usd.format(data.totalUsd)}</strong></td></tr>
      </table>
      <p style="color:#888;font-size:12px">Exchange rate: ${idr.format(data.exchangeRate)} per USD 1.00</p>
    </div>`;

  try {
    await mailer.sendMail({ from: env.smtp.from, to, subject: `Payslip — ${period}`, html });
    console.log(`[email] sent "Payslip — ${period}" to ${to}`);
    return true;
  } catch (err) {
    console.error(`[email] failed to send payslip to ${to}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// Notifies the requester when HR approves or rejects their leave request.
export async function sendLeaveDecisionEmail(
  to: string,
  status: 'APPROVED' | 'REJECTED',
  data: LeaveEmailData & { rejectReason?: string | null },
): Promise<void> {
  const color = status === 'APPROVED' ? '#52c41a' : '#ff4d4f';
  const rejectRow =
    status === 'REJECTED'
      ? `<p><strong>Reason for rejection:</strong> ${data.rejectReason ?? '-'}</p>`
      : '';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#333">
      <h2 style="color:${color}">Leave Request ${status}</h2>
      <p>Your leave request has been <strong>${status.toLowerCase()}</strong>.</p>
      ${leaveDetailsTable(data)}
      ${rejectRow}
    </div>`;
  await sendMail(to, `Your leave request was ${status.toLowerCase()}`, html);
}
