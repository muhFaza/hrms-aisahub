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
