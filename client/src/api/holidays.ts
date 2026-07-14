import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export type HolidayType = 'NATIONAL' | 'COMPANY' | 'JOINT_LEAVE' | 'SPECIAL';

export interface Holiday {
  id: number;
  name: string;
  date: string;
  type: HolidayType;
  notes: string | null;
  createdAt: string;
}

export interface HolidayPayload {
  name: string;
  date: string;
  type: HolidayType;
  notes?: string | null;
}

export function useHolidays(year: number) {
  return useQuery({
    queryKey: ['holidays', year],
    queryFn: async () => {
      const { data } = await apiClient.get<Holiday[]>('/holidays', { params: { year } });
      return data;
    },
  });
}

export function useCreateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: HolidayPayload) => {
      const { data } = await apiClient.post<Holiday>('/holidays', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });
}

export function useUpdateHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: HolidayPayload }) => {
      const { data } = await apiClient.put<Holiday>(`/holidays/${id}`, payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });
}

export function useDeleteHoliday() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/holidays/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['holidays'] }),
  });
}

// Tag colors shared by tables/calendar (design §6 color-coded holiday types).
export const holidayTypeColor: Record<HolidayType, string> = {
  NATIONAL: 'red',
  COMPANY: 'blue',
  JOINT_LEAVE: 'gold',
  SPECIAL: 'purple',
};

export const holidayTypeLabel: Record<HolidayType, string> = {
  NATIONAL: 'National',
  COMPANY: 'Company',
  JOINT_LEAVE: 'Joint Leave',
  SPECIAL: 'Special',
};
