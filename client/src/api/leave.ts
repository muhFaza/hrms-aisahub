import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { Holiday } from './holidays';

export type LeaveType = 'PAID' | 'SICK' | 'UNPAID';

// Decimal totalDays is serialized as a number by the leave service.
export interface LeaveRequest {
  id: number;
  employeeId: number;
  employeeName: string | null;
  employeeNickname: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  createdAt: string;
}

export interface LeaveListParams {
  type?: LeaveType;
  employeeId?: number;
  page?: number;
  pageSize?: number;
}

export interface LeaveListResponse {
  data: LeaveRequest[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AccrualRow {
  id: number;
  period: string;
  days: number;
  daysConsumed: number;
  remaining: number;
  expiresAt: string;
  expired: boolean;
}

export interface LeaveBalance {
  balance: number;
  accruedTotal: number;
  usedTotal: number;
  expiredTotal: number;
  sickTaken: number;
  unpaidTaken: number;
  expiringSoon: { days: number; expiresAt: string }[];
  rows: AccrualRow[];
}

export interface LeaveBalanceSummary {
  employeeId: number;
  employeeName: string;
  nickname: string | null;
  balance: number;
  accrued: number;
  used: number;
  expired: number;
  sickTaken: number;
  unpaidTaken: number;
}

export interface CalendarLeave {
  id: number;
  employeeName: string;
  employeeNickname: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
}

export interface LeaveCalendarResponse {
  leaves: CalendarLeave[];
  holidays: Holiday[];
}

export interface SubmitLeavePayload {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export function useLeaveRequests(params: LeaveListParams) {
  return useQuery({
    queryKey: ['leave', params],
    queryFn: async () => {
      const { data } = await apiClient.get<LeaveListResponse>('/leave', { params });
      return data;
    },
  });
}

export function useLeaveBalance(employeeId?: number) {
  return useQuery({
    queryKey: ['leave-balance', employeeId ?? 'self'],
    queryFn: async () => {
      const { data } = await apiClient.get<LeaveBalance>('/leave/balance', {
        params: employeeId ? { employeeId } : undefined,
      });
      return data;
    },
  });
}

export function useLeaveBalances() {
  return useQuery({
    queryKey: ['leave-balances'],
    queryFn: async () => {
      const { data } = await apiClient.get<LeaveBalanceSummary[]>('/leave/balances');
      return data;
    },
  });
}

export function useLeaveCalendar(month: string) {
  return useQuery({
    queryKey: ['leave-calendar', month],
    queryFn: async () => {
      const { data } = await apiClient.get<LeaveCalendarResponse>('/leave/calendar', {
        params: { month },
      });
      return data;
    },
  });
}

// Invalidates leave lists, balances and the calendar after any mutation.
function useLeaveInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['leave'] });
    queryClient.invalidateQueries({ queryKey: ['leave-balance'] });
    queryClient.invalidateQueries({ queryKey: ['leave-balances'] });
    queryClient.invalidateQueries({ queryKey: ['leave-calendar'] });
  };
}

export function useSubmitLeave() {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: async (payload: SubmitLeavePayload) => {
      const { data } = await apiClient.post<LeaveRequest>('/leave', payload);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCancelLeave() {
  const invalidate = useLeaveInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/leave/${id}`);
    },
    onSuccess: invalidate,
  });
}

export const leaveTypeColor: Record<LeaveType, string> = {
  PAID: 'green',
  SICK: 'orange',
  UNPAID: 'volcano',
};

export const leaveTypeLabel: Record<LeaveType, string> = {
  PAID: 'Paid Leave',
  SICK: 'Sick Leave',
  UNPAID: 'Unpaid Leave',
};
