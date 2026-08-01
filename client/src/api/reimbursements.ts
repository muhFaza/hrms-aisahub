import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { RequestStatus } from './overtime';

export interface Reimbursement {
  id: number;
  employeeId: number;
  employeeName: string | null;
  employeeNickname: string | null;
  date: string;
  amount: number;
  // Both are required by the API and NOT NULL in the database; legacy rows carry ''.
  description: string;
  evidenceFilePath: string;
  status: RequestStatus;
  reviewedById: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface ReimbursementListParams {
  status?: RequestStatus;
  employeeId?: number;
  page?: number;
  pageSize?: number;
}

export interface ReimbursementListResponse {
  data: Reimbursement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SubmitReimbursementPayload {
  date: string;
  amount: number;
  description: string;
  evidence: File;
}

export interface ReviewReimbursementPayload {
  action: 'APPROVE' | 'REJECT';
  rejectReason?: string | null;
}

export function useReimbursements(params: ReimbursementListParams) {
  return useQuery({
    queryKey: ['reimbursements', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ReimbursementListResponse>('/reimbursements', { params });
      return data;
    },
  });
}

function useReimbursementInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
}

export function useSubmitReimbursement() {
  const invalidate = useReimbursementInvalidation();
  return useMutation({
    mutationFn: async (payload: SubmitReimbursementPayload) => {
      const form = new FormData();
      form.append('date', payload.date);
      form.append('amount', String(payload.amount));
      form.append('description', payload.description);
      form.append('evidence', payload.evidence);
      const { data } = await apiClient.post<Reimbursement>('/reimbursements', form);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useReviewReimbursement() {
  const invalidate = useReimbursementInvalidation();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ReviewReimbursementPayload }) => {
      const { data } = await apiClient.patch<Reimbursement>(`/reimbursements/${id}/review`, payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCancelReimbursement() {
  const invalidate = useReimbursementInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/reimbursements/${id}`);
    },
    onSuccess: invalidate,
  });
}

// Downloads the evidence file as a blob (auth header applied by the interceptor).
export async function downloadEvidence(id: number, fileName: string): Promise<void> {
  const response = await apiClient.get(`/reimbursements/${id}/evidence`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(response.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
