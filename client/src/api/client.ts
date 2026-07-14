import axios from 'axios';

// Shared axios instance for all API calls (proxied to the server at /api/v1).
export const apiClient = axios.create({
  baseURL: '/api/v1',
});

// Attach the JWT from localStorage to every request when present.
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On an expired/invalid session, drop the token and bounce to login.
// Login failures (wrong password) are excluded so the form can show the error.
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url: string = error.config?.url ?? '';
    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  },
);
