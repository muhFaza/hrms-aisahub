import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

export interface UserRow {
  id: number;
  email: string;
  roleId: number;
  roleName: string;
  employeeId: number | null;
  employeeName: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Role {
  id: number;
  name: string;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  roleId: number;
  employeeId?: number | null;
}

// No roleId: a user's role is fixed at creation and the API rejects changes to it.
export interface UpdateUserPayload {
  isActive?: boolean;
  password?: string;
  employeeId?: number | null;
}

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await apiClient.get<UserRow[]>('/users');
      return data;
    },
  });
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await apiClient.get<Role[]>('/users/roles');
      return data;
    },
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateUserPayload) => {
      const { data } = await apiClient.post<UserRow>('/users', payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: UpdateUserPayload }) => {
      const { data } = await apiClient.patch<UserRow>(`/users/${id}`, payload);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}
