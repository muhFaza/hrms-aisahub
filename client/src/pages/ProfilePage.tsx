import { Card, Result, Skeleton, Typography } from 'antd';
import { useAuth } from '../lib/AuthContext';
import { useEmployee } from '../api/employees';
import EmployeeDescriptions from './employees/EmployeeDescriptions';

export default function ProfilePage() {
  const { user } = useAuth();
  const employeeId = user?.employee?.id;
  const { data: employee, isLoading, isError } = useEmployee(employeeId);

  if (!employeeId) {
    return <Result status="warning" title="No employee profile is linked to this account." />;
  }
  if (isLoading) {
    return (
      <Card>
        <Skeleton active />
      </Card>
    );
  }
  if (isError || !employee) {
    return <Result status="404" title="Profile not found" />;
  }

  return (
    <Card>
      <Typography.Title level={4}>My Profile</Typography.Title>
      <EmployeeDescriptions employee={employee} />
    </Card>
  );
}
