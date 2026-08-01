import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth, RequireFullTime, RequireRole } from './lib/guards';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProfilePage from './pages/ProfilePage';
import EmployeesListPage from './pages/employees/EmployeesListPage';
import EmployeeDetailPage from './pages/employees/EmployeeDetailPage';
import HolidaysPage from './pages/holidays/HolidaysPage';
import LeaveReviewPage from './pages/leave/LeaveReviewPage';
import MyLeavePage from './pages/leave/MyLeavePage';
import MyDailyLogPage from './pages/daily-logs/MyDailyLogPage';
import DailyLogsReviewPage from './pages/daily-logs/DailyLogsReviewPage';
import MyOvertimePage from './pages/overtime/MyOvertimePage';
import OvertimeReviewPage from './pages/overtime/OvertimeReviewPage';
import MyReimbursementsPage from './pages/reimbursements/MyReimbursementsPage';
import ReimbursementsReviewPage from './pages/reimbursements/ReimbursementsReviewPage';
import PayrollPage from './pages/payroll/PayrollPage';
import PayrollPeriodDetailPage from './pages/payroll/PayrollPeriodDetailPage';
import MyPayslipsPage from './pages/payroll/MyPayslipsPage';
import UsersPage from './pages/users/UsersPage';
import NotificationsPage from './pages/notifications/NotificationsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        {/* Notifications are per-user, so both roles get the same page. */}
        <Route path="/notifications" element={<NotificationsPage />} />

        {/* HR-only modules; employees hitting these get a 403 result page. */}
        <Route
          path="/employees"
          element={
            <RequireRole role="HR">
              <EmployeesListPage />
            </RequireRole>
          }
        />
        <Route
          path="/employees/:id"
          element={
            <RequireRole role="HR">
              <EmployeeDetailPage />
            </RequireRole>
          }
        />
        <Route
          path="/leave"
          element={
            <RequireRole role="HR">
              <LeaveReviewPage />
            </RequireRole>
          }
        />
        {/* Holidays: HR manages, employees see a read-only calendar + list. */}
        <Route path="/holidays" element={<HolidaysPage />} />
        <Route
          path="/daily-logs"
          element={
            <RequireRole role="HR">
              <DailyLogsReviewPage />
            </RequireRole>
          }
        />
        <Route
          path="/overtime"
          element={
            <RequireRole role="HR">
              <OvertimeReviewPage />
            </RequireRole>
          }
        />
        <Route
          path="/reimbursements"
          element={
            <RequireRole role="HR">
              <ReimbursementsReviewPage />
            </RequireRole>
          }
        />
        <Route
          path="/payroll"
          element={
            <RequireRole role="HR">
              <PayrollPage />
            </RequireRole>
          }
        />
        <Route
          path="/payroll/:id"
          element={
            <RequireRole role="HR">
              <PayrollPeriodDetailPage />
            </RequireRole>
          }
        />
        <Route
          path="/users"
          element={
            <RequireRole role="HR">
              <UsersPage />
            </RequireRole>
          }
        />

        {/* Employee self-service modules. */}
        <Route
          path="/my-leave"
          element={
            <RequireFullTime>
              <MyLeavePage />
            </RequireFullTime>
          }
        />
        <Route path="/my-daily-log" element={<MyDailyLogPage />} />
        <Route path="/my-overtime" element={<MyOvertimePage />} />
        <Route path="/my-reimbursements" element={<MyReimbursementsPage />} />
        <Route path="/my-payslips" element={<MyPayslipsPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}
