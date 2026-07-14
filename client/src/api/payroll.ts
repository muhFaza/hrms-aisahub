import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export type PayrollStatus = 'DRAFT' | 'FINALIZED';
export type RateSource = 'API' | 'FALLBACK' | 'MANUAL';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME';

export interface PayrollPeriod {
  id: number;
  year: number;
  month: number;
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
  derivedHourly?: number;
  dailyRate?: number;
  exchangeRate: number;
}

export interface PayslipRow {
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
  emailSentAt: string | null;
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
    mutationFn: async (payload: { year: number; month: number }) => {
      const { data } = await apiClient.post<PayrollPeriod>('/payroll/periods', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateRate() {
  const invalidate = usePayrollInvalidation();
  return useMutation({
    mutationFn: async ({ id, exchangeRate }: { id: number; exchangeRate: number }) => {
      const { data } = await apiClient.patch<PayrollPeriod>(`/payroll/periods/${id}`, {
        exchangeRate,
      });
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

export function useMyPayslips() {
  return useQuery({
    queryKey: ['my-payslips'],
    queryFn: async () => {
      const { data } = await apiClient.get<MyPayslip[]>('/payroll/my-payslips');
      return data;
    },
  });
}
