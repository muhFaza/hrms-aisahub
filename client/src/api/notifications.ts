import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export type NotificationType =
  | 'LEAVE_SUBMITTED'
  | 'LEAVE_DECIDED'
  | 'OVERTIME_SUBMITTED'
  | 'OVERTIME_DECIDED'
  | 'REIMBURSEMENT_SUBMITTED'
  | 'REIMBURSEMENT_DECIDED'
  | 'PAYSLIP_AVAILABLE'
  | 'REQUEST_CANCELLED';

// payload is server-stored JSON; notificationCopy reads it defensively.
export interface AppNotification {
  id: number;
  type: NotificationType;
  entityType: string;
  entityId: number;
  payload: Record<string, unknown>;
  readAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  createdAt: string;
}

export interface NotificationListParams {
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
}

export interface NotificationListResponse {
  data: AppNotification[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UnreadCountResponse {
  count: number;
}

// Poll interval for the header badge, per the notifications design.
const UNREAD_POLL_MS = 30_000;

export function useNotifications(params: NotificationListParams, enabled = true) {
  return useQuery({
    queryKey: ['notifications', params],
    enabled,
    queryFn: async () => {
      const { data } = await apiClient.get<NotificationListResponse>('/notifications', {
        // Only send unreadOnly when set — a literal 'false' coerces to true server-side.
        params: {
          page: params.page,
          pageSize: params.pageSize,
          unreadOnly: params.unreadOnly ? true : undefined,
        },
      });
      return data;
    },
  });
}

export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications-unread-count'],
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => {
      const { data } = await apiClient.get<UnreadCountResponse>('/notifications/unread-count');
      return data;
    },
  });
}

// Invalidates the lists and the header badge after any read mutation.
function useNotificationInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };
}

export function useMarkNotificationRead() {
  const invalidate = useNotificationInvalidation();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await apiClient.patch<AppNotification>(`/notifications/${id}/read`);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead() {
  const invalidate = useNotificationInvalidation();
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/notifications/read-all');
    },
    onSuccess: invalidate,
  });
}
