import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { EmploymentType } from './auth';

export type EmploymentStatus = 'ACTIVE' | 'TERMINATED';
export type EmploymentEndReason = 'CONTRACT_END' | 'RESIGNATION' | 'DISMISSAL' | 'OTHER';

// One period of employment. A rehire opens a new one rather than editing the old, so this
// list is the audit trail of somebody's engagements.
export interface Employment {
  id: number;
  startDate: string;
  endDate: string | null;
  endReason: EmploymentEndReason | null;
  endNote: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractFilePath: string | null;
  fullTimeSince: string | null;
  leaveBalanceAtEnd: number | null;
  recordedById: number | null;
  createdAt: string;
}

// Decimal columns arrive as strings from the server (Prisma Decimal.toJSON).
export interface Employee {
  id: number;
  fullName: string;
  nickname: string | null;
  joinDate: string;
  position: string;
  employmentType: EmploymentType;
  // Paid-leave accrual anchor; null for part-timers. See handbook/domain-rules.md.
  fullTimeSince: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  contractFilePath: string | null;
  monthlySalary: string | null;
  hourlyRate: string | null;
  email: string | null;
  university: string | null;
  major: string | null;
  graduationYear: number | null;
  linkedinUrl: string | null;
  religion: string | null;
  thrEligible: boolean;
  bankName: string | null;
  bankAccountNumber: string | null;
  ktpNumber: string | null;
  phoneNumber: string | null;
  // Derived from the current employment, never stored. The contract fields above come from
  // that same employment; `employments` is the full history, newest first.
  status: EmploymentStatus;
  terminationDate: string | null;
  employments: Employment[];
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeListParams {
  search?: string;
  employmentType?: EmploymentType;
  status?: EmploymentStatus;
  page?: number;
  pageSize?: number;
}

export interface EmployeeListResponse {
  data: Employee[];
  total: number;
  page: number;
  pageSize: number;
}

// Payload for create/update; dates as ISO strings, money as numbers.
export interface EmployeeFormPayload {
  fullName: string;
  nickname?: string | null;
  joinDate: string;
  position: string;
  employmentType: EmploymentType;
  // Omit to let the server derive it from the employmentType transition.
  fullTimeSince?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  monthlySalary?: number | null;
  hourlyRate?: number | null;
  email?: string | null;
  university?: string | null;
  major?: string | null;
  graduationYear?: number | null;
  linkedinUrl?: string | null;
  religion?: string | null;
  thrEligible?: boolean;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  ktpNumber?: string | null;
  phoneNumber?: string | null;
}

// Ending an employment. The date is HR's to choose: a past date records a termination late,
// a future one serves notice, and it need not match the contract end date.
export interface TerminatePayload {
  endDate: string;
  endReason: EmploymentEndReason;
  endNote?: string | null;
}

export interface RehirePayload {
  startDate: string;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  fullTimeSince?: string | null;
}

export function useEmployees(params: EmployeeListParams) {
  return useQuery({
    queryKey: ['employees', params],
    queryFn: async () => {
      const { data } = await apiClient.get<EmployeeListResponse>('/employees', { params });
      return data;
    },
  });
}

export function useEmployee(id: number | undefined) {
  return useQuery({
    queryKey: ['employee', id],
    enabled: id !== undefined,
    queryFn: async () => {
      const { data } = await apiClient.get<Employee>(`/employees/${id}`);
      return data;
    },
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: EmployeeFormPayload) => {
      const { data } = await apiClient.post<Employee>('/employees', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['employees'] }),
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: EmployeeFormPayload }) => {
      const { data } = await apiClient.put<Employee>(`/employees/${id}`, payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee', variables.id] });
    },
  });
}

export function useUploadContract() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file }: { id: number; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      const { data } = await apiClient.post<Employee>(`/employees/${id}/contract`, form);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee', variables.id] });
    },
  });
}

// Downloads the contract as a blob (auth header applied by the interceptor).
export async function downloadContract(id: number, fileName: string): Promise<void> {
  const response = await apiClient.get(`/employees/${id}/contract`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function useTerminateEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: TerminatePayload }) => {
      const { data } = await apiClient.post<Employee>(`/employees/${id}/terminate`, payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee', variables.id] });
      // Termination moves headcount, leave balances and the payroll preview.
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
    },
  });
}

export function useRehireEmployee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: RehirePayload }) => {
      const { data } = await apiClient.post<Employee>(`/employees/${id}/rehire`, payload);
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      queryClient.invalidateQueries({ queryKey: ['employee', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
    },
  });
}
