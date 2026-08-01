import { useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

export type RoleName = 'HR' | 'EMPLOYEE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME';

export interface AuthEmployee {
  id: number;
  fullName: string;
  nickname: string | null;
  employmentType: EmploymentType;
}

export interface AuthUser {
  id: number;
  email: string;
  roleName: RoleName;
  employee: AuthEmployee | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

export async function fetchMe(): Promise<AuthUser> {
  const { data } = await apiClient.get<AuthUser>('/auth/me');
  return data;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

// Nothing to invalidate: no query holds the password, and the current token stays valid.
export function useChangePassword() {
  return useMutation({
    mutationFn: async (payload: ChangePasswordPayload) => {
      await apiClient.post('/auth/password', payload);
    },
  });
}
