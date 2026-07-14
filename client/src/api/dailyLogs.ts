import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface DailyLog {
  id: number;
  employeeId: number;
  employeeName: string | null;
  employeeNickname: string | null;
  date: string;
  hours: number;
  project: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyLogListParams {
  employeeId?: number;
  month?: string;
  page?: number;
  pageSize?: number;
}

export interface DailyLogListResponse {
  data: DailyLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DailyLogPayload {
  date: string;
  hours: number;
  project: string;
  notes?: string | null;
}

export function useDailyLogs(params: DailyLogListParams) {
  return useQuery({
    queryKey: ['daily-logs', params],
    queryFn: async () => {
      const { data } = await apiClient.get<DailyLogListResponse>('/daily-logs', { params });
      return data;
    },
  });
}

function useDailyLogInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['daily-logs'] });
}

export function useCreateDailyLog() {
  const invalidate = useDailyLogInvalidation();
  return useMutation({
    mutationFn: async (payload: DailyLogPayload) => {
      const { data } = await apiClient.post<DailyLog>('/daily-logs', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateDailyLog() {
  const invalidate = useDailyLogInvalidation();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: DailyLogPayload }) => {
      const { data } = await apiClient.put<DailyLog>(`/daily-logs/${id}`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDailyLog() {
  const invalidate = useDailyLogInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/daily-logs/${id}`);
    },
    onSuccess: invalidate,
  });
}
