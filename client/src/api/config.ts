import { apiClient } from './client';

export interface AppConfig {
  demoMode: boolean;
}

// Unauthenticated — the login page calls this before a token exists.
export async function fetchConfig(): Promise<AppConfig> {
  const { data } = await apiClient.get<AppConfig>('/config');
  return data;
}
