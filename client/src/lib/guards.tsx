import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './AuthContext';
import ForbiddenPage from '../pages/ForbiddenPage';
import type { RoleName } from '../api/auth';

// Blocks unauthenticated access; waits for the session bootstrap to finish first.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// Restricts a route to a single role; other roles get a 403 result page (UAT scenario).
export function RequireRole({ role, children }: { role: RoleName; children: ReactNode }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (user.roleName !== role) {
    return <ForbiddenPage />;
  }
  return <>{children}</>;
}
