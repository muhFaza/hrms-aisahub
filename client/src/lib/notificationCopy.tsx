import type { ReactNode } from 'react';
import {
  BankOutlined,
  BellOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  SolutionOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { AppNotification, NotificationType } from '../api/notifications';
import { formatDate, formatIDR, formatPeriod, formatUSD } from './format';

export interface NotificationCopy {
  title: string;
  description: string;
  link: string;
  icon: ReactNode;
}

// The payload is server-stored JSON, so every field is read defensively —
// an unexpected shape degrades the copy rather than crashing the bell.
function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function amount(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function joinParts(parts: (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

function who(payload: Record<string, unknown>): string {
  return text(payload, 'employeeName') ?? 'An employee';
}

function decisionTitle(payload: Record<string, unknown>, subject: string): string {
  const status = text(payload, 'status');
  if (status === 'APPROVED') return `${subject} approved`;
  if (status === 'REJECTED') return `${subject} rejected`;
  return `${subject} reviewed`;
}

function dateRange(payload: Record<string, unknown>): string | null {
  const startDate = text(payload, 'startDate');
  const endDate = text(payload, 'endDate');
  if (!startDate && !endDate) return null;
  if (startDate && endDate && startDate !== endDate) {
    return `${formatDate(startDate)} — ${formatDate(endDate)}`;
  }
  return formatDate(startDate ?? endDate);
}

function dayCount(payload: Record<string, unknown>): string | null {
  const totalDays = amount(payload, 'totalDays');
  if (totalDays === null) return null;
  return `${totalDays} ${totalDays === 1 ? 'day' : 'days'}`;
}

function hourCount(payload: Record<string, unknown>): string | null {
  const hours = amount(payload, 'hours');
  if (hours === null) return null;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function rejectNote(payload: Record<string, unknown>): string | null {
  const reason = text(payload, 'rejectReason');
  return reason ? `Reason: ${reason}` : null;
}

// A cancelled request routes to the HR list for whichever module it came from.
const cancelledLink: Record<string, string> = {
  LEAVE: '/leave',
  OVERTIME: '/overtime',
  REIMBURSEMENT: '/reimbursements',
};

const builders: Record<NotificationType, (payload: Record<string, unknown>) => NotificationCopy> = {
  // Informational, not a queue item: leave is recorded on submit and needs no HR action.
  LEAVE_SUBMITTED: (payload) => ({
    title: `${who(payload)} recorded leave`,
    description: joinParts([text(payload, 'leaveType'), dateRange(payload), dayCount(payload)]),
    link: '/leave',
    icon: <CalendarOutlined />,
  }),
  // No longer emitted — leave has no approval step. Kept so historical rows still render.
  LEAVE_DECIDED: (payload) => ({
    title: decisionTitle(payload, 'Leave request'),
    description: joinParts([
      text(payload, 'leaveType'),
      dateRange(payload),
      dayCount(payload),
      rejectNote(payload),
    ]),
    link: '/my-leave',
    icon: <CalendarOutlined />,
  }),
  OVERTIME_SUBMITTED: (payload) => ({
    title: `${who(payload)} submitted overtime`,
    description: joinParts([
      text(payload, 'date') ? formatDate(text(payload, 'date')) : null,
      hourCount(payload),
    ]),
    link: '/overtime',
    icon: <ClockCircleOutlined />,
  }),
  OVERTIME_DECIDED: (payload) => ({
    title: decisionTitle(payload, 'Overtime request'),
    description: joinParts([
      text(payload, 'date') ? formatDate(text(payload, 'date')) : null,
      hourCount(payload),
      rejectNote(payload),
    ]),
    link: '/my-overtime',
    icon: <ClockCircleOutlined />,
  }),
  REIMBURSEMENT_SUBMITTED: (payload) => ({
    title: `${who(payload)} submitted a reimbursement`,
    description: joinParts([
      text(payload, 'title'),
      amount(payload, 'amount') !== null ? formatIDR(amount(payload, 'amount')) : null,
    ]),
    link: '/reimbursements',
    icon: <DollarOutlined />,
  }),
  REIMBURSEMENT_DECIDED: (payload) => ({
    title: decisionTitle(payload, 'Reimbursement'),
    description: joinParts([
      text(payload, 'title'),
      amount(payload, 'amount') !== null ? formatIDR(amount(payload, 'amount')) : null,
      rejectNote(payload),
    ]),
    link: '/my-reimbursements',
    icon: <DollarOutlined />,
  }),
  PAYSLIP_AVAILABLE: (payload) => {
    const year = amount(payload, 'year');
    const month = amount(payload, 'month');
    const period = year !== null && month !== null ? formatPeriod(year, month) : null;
    return {
      title: period ? `Payslip for ${period} is ready` : 'A new payslip is ready',
      description: joinParts([
        amount(payload, 'totalIdr') !== null ? formatIDR(amount(payload, 'totalIdr')) : null,
        amount(payload, 'totalUsd') !== null ? formatUSD(amount(payload, 'totalUsd')) : null,
      ]),
      link: '/my-payslips',
      icon: <BankOutlined />,
    };
  },
  CONTRACT_ENDING: (payload) => {
    const name = text(payload, 'employeeNickname') ?? text(payload, 'employeeName');
    const endDate = text(payload, 'contractEndDate');
    const daysRemaining = amount(payload, 'daysRemaining');
    // Negative days means the contract already lapsed — more urgent, not less, so it is
    // called out rather than shown as a countdown to a date in the past.
    const lapsed = daysRemaining !== null && daysRemaining < 0;
    return {
      title: lapsed
        ? `${name ?? 'An employee'}'s contract has ended`
        : `${name ?? 'An employee'}'s contract is ending`,
      description: joinParts([
        endDate ? formatDate(endDate) : null,
        daysRemaining === null
          ? null
          : lapsed
            ? `${Math.abs(daysRemaining)} day(s) ago`
            : `in ${daysRemaining} day(s)`,
      ]),
      link: amount(payload, 'employeeId') !== null
        ? `/employees/${amount(payload, 'employeeId')}`
        : '/employees',
      icon: <SolutionOutlined />,
    };
  },
  REQUEST_CANCELLED: (payload) => {
    const kind = text(payload, 'kind');
    const label = kind ? kind.toLowerCase() : 'pending';
    return {
      title: `${who(payload)} cancelled a ${label} request`,
      description: '',
      link: (kind && cancelledLink[kind]) ?? '/notifications',
      icon: <StopOutlined />,
    };
  },
};

export function getNotificationCopy(notification: AppNotification): NotificationCopy {
  const payload =
    notification.payload && typeof notification.payload === 'object' ? notification.payload : {};
  const build = builders[notification.type];
  if (!build) {
    // Unknown type — readable rather than blank, and never a crash.
    return {
      title: 'Notification',
      description: notification.entityType ? `${notification.entityType} update` : '',
      link: '/notifications',
      icon: <BellOutlined />,
    };
  }
  return build(payload);
}
