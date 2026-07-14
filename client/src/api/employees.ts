import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { EmploymentType } from './auth';

// Decimal columns arrive as strings from the server (Prisma Decimal.toJSON).
export interface Employee {
  id: number;
  fullName: string;
  nickname: string | null;
  joinDate: string;
  position: string;
  employmentType: EmploymentType;
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
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeListParams {
  search?: string;
  employmentType?: EmploymentType;
  isActive?: boolean;
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
  isActive?: boolean;
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
