import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Overtime {
  id: number;
  employeeId: number;
  employeeName: string | null;
  employeeNickname: string | null;
  date: string;
  hours: number;
  description: string | null;
  status: RequestStatus;
  reviewedById: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface OvertimeListParams {
  status?: RequestStatus;
  employeeId?: number;
  page?: number;
  pageSize?: number;
}

export interface OvertimeListResponse {
  data: Overtime[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubmitOvertimePayload {
  date: string;
  hours: number;
  description: string;
}

export interface ReviewOvertimePayload {
  action: 'APPROVE' | 'REJECT';
  rejectReason?: string | null;
}

export function useOvertime(params: OvertimeListParams) {
  return useQuery({
    queryKey: ['overtime', params],
    queryFn: async () => {
      const { data } = await apiClient.get<OvertimeListResponse>('/overtime', { params });
      return data;
    },
  });
}

function useOvertimeInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['overtime'] });
}

export function useSubmitOvertime() {
  const invalidate = useOvertimeInvalidation();
  return useMutation({
    mutationFn: async (payload: SubmitOvertimePayload) => {
      const { data } = await apiClient.post<Overtime>('/overtime', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useReviewOvertime() {
  const invalidate = useOvertimeInvalidation();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ReviewOvertimePayload }) => {
      const { data } = await apiClient.patch<Overtime>(`/overtime/${id}/review`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCancelOvertime() {
  const invalidate = useOvertimeInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/overtime/${id}`);
    },
    onSuccess: invalidate,
  });
}

export const requestStatusColor: Record<RequestStatus, string> = {
  PENDING: 'gold',
  APPROVED: 'green',
  REJECTED: 'red',
};
