import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import { downloadFile } from '../lib/download';

export type PayrollStatus = 'DRAFT' | 'FINALIZED';
export type RateSource = 'API' | 'FALLBACK' | 'MANUAL';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME';

export interface PayrollPeriod {
  id: number;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  exchangeRate: number;
  rateSource: RateSource;
  status: PayrollStatus;
  finalizedAt: string | null;
  finalizedById: number | null;
  payslipCount: number;
  createdAt: string;
}

export interface PayslipDetail {
  employmentType: EmploymentType;
  monthlySalary?: number;
  hourlyRate?: number;
  overtimeHours: number;
  overtimeIds: number[];
  dailyLogHours: number;
  dailyLogIds: number[];
  reimbursementIds: number[];
  sickDays: number;
  sickLeaveIds: number[];
  // Optional: detail is a persisted JSON snapshot, and payslips finalized before unpaid
  // leave existed have neither field.
  unpaidDays?: number;
  unpaidLeaveIds?: number[];
  derivedHourly?: number;
  dailyRate?: number;
  exchangeRate: number;
  // Optional for the same reason: payslips finalized before the attendance summary existed
  // carry no such block. Currently rendered on the payslip PDF only.
  attendance?: PayslipAttendance;
}

export interface PayslipAttendance {
  periodStart: string;
  periodEnd: string;
  scheduledWorkingDays: number;
  actualWorkingDays: number;
  dayOffDays: number;
  nationalHolidayDays: number;
  companyHolidayDays: number;
  leaveDays: number;
}

export interface PayslipRow {
  // Present only once the period is finalized — a draft has no stored payslip to export.
  payslipId?: number;
  employeeId: number;
  name: string;
  employmentType: EmploymentType;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  detail: PayslipDetail;
}

export interface PayrollTotals {
  count: number;
  totalIdr: number;
  totalUsd: number;
}

export interface PayrollPreview {
  period: PayrollPeriod;
  rows: PayslipRow[];
  totals: PayrollTotals;
}

export interface MyPayslip {
  id: number;
  payrollPeriodId: number;
  year: number;
  month: number;
  exchangeRate: number;
  finalizedAt: string | null;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  detail: PayslipDetail;
}

export const payrollStatusColor: Record<PayrollStatus, string> = {
  DRAFT: 'gold',
  FINALIZED: 'green',
};

export const rateSourceColor: Record<RateSource, string> = {
  API: 'green',
  FALLBACK: 'orange',
  MANUAL: 'blue',
};

export function usePayrollPeriods() {
  return useQuery({
    queryKey: ['payroll-periods'],
    queryFn: async () => {
      const { data } = await apiClient.get<PayrollPeriod[]>('/payroll/periods');
      return data;
    },
  });
}

export function usePayrollPreview(id: number | undefined) {
  return useQuery({
    queryKey: ['payroll-preview', id],
    enabled: id !== undefined,
    queryFn: async () => {
      const { data } = await apiClient.get<PayrollPreview>(`/payroll/periods/${id}`);
      return data;
    },
  });
}

function usePayrollInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['payroll-periods'] });
    queryClient.invalidateQueries({ queryKey: ['payroll-preview'] });
  };
}

export function useCreatePeriod() {
  const invalidate = usePayrollInvalidation();
  return useMutation({
    mutationFn: async (payload: {
      year: number;
      month: number;
      startDate: string;
      endDate: string;
    }) => {
      const { data } = await apiClient.post<PayrollPeriod>('/payroll/periods', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdatePeriod() {
  const invalidate = usePayrollInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: number;
      exchangeRate?: number;
      startDate?: string;
      endDate?: string;
    }) => {
      const { data } = await apiClient.patch<PayrollPeriod>(`/payroll/periods/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useFinalizePeriod() {
  const invalidate = usePayrollInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await apiClient.post<PayrollPreview>(`/payroll/periods/${id}/finalize`);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeletePeriod() {
  const invalidate = usePayrollInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/payroll/periods/${id}`);
    },
    onSuccess: invalidate,
  });
}

// Exports are downloads, not cached queries — they go straight through the blob helper.
export function exportPeriodPdf(id: number, year: number, month: number) {
  return downloadFile(`/payroll/periods/${id}/export/pdf`, `payroll-${periodSlug(year, month)}.pdf`);
}

export function exportPeriodCsv(id: number, year: number, month: number) {
  return downloadFile(`/payroll/periods/${id}/export/csv`, `payout-${periodSlug(year, month)}.csv`);
}

export function exportPayslipPdf(payslipId: number, year: number, month: number) {
  return downloadFile(
    `/payroll/payslips/${payslipId}/export/pdf`,
    `payslip-${periodSlug(year, month)}.pdf`,
  );
}

// Only used for the fallback filename when Content-Disposition is unreadable.
function periodSlug(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function useMyPayslips() {
  return useQuery({
    queryKey: ['my-payslips'],
    queryFn: async () => {
      const { data } = await apiClient.get<MyPayslip[]>('/payroll/my-payslips');
      return data;
    },
  });
}
