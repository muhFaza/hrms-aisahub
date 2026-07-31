import { useQuery } from '@tanstack/react-query';
import { apiClient } from './client';
import type { HolidayType } from './holidays';
import type { LeaveBalance, LeaveType } from './leave';
import type { PayrollStatus } from './payroll';

export interface OnLeaveTodayEntry {
  employeeName: string;
  type: LeaveType;
  until: string;
}

export interface UpcomingHoliday {
  name: string;
  date: string;
  type: HolidayType;
}

export interface HrDashboard {
  headcount: { total: number; fullTime: number; partTime: number; active: number };
  pendingApprovals: { overtime: number; reimbursements: number };
  onLeaveToday: OnLeaveTodayEntry[];
  upcomingHolidays: UpcomingHoliday[];
  payroll: {
    latestPeriod: { year: number; month: number; status: PayrollStatus; payslipCount: number } | null;
  };
  leaveThisMonth: number;
}

export interface EmployeeDashboard {
  leaveBalance: LeaveBalance | null;
  pending: { overtime: number; reimbursements: number };
  onLeaveToday: OnLeaveTodayEntry[];
  upcomingHolidays: UpcomingHoliday[];
  thisMonth: { dailyLogHours?: number; approvedOvertimeHours?: number };
  latestPayslip: { period: { year: number; month: number }; totalIdr: number } | null;
}

// Same endpoint, role-scoped response — the page enables only the query for its role.
export function useHrDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'hr'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<HrDashboard>('/dashboard');
      return data;
    },
  });
}

export function useEmployeeDashboard(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'employee'],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<EmployeeDashboard>('/dashboard');
      return data;
    },
  });
}
