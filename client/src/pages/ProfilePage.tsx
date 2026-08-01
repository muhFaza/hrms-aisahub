import { Alert, Button, Card, Form, Input, Result, Skeleton, Space, Typography, message } from 'antd';
import { AxiosError } from 'axios';
import { useAuth } from '../lib/AuthContext';
import { useChangePassword } from '../api/auth';
import { useEmployee } from '../api/employees';
import EmployeeDescriptions from './employees/EmployeeDescriptions';

interface PasswordFormValues {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

// Password change is available to every account, including HR accounts with no employee
// profile — so it lives outside the employeeId guard below.
function ChangePasswordCard() {
  const [form] = Form.useForm<PasswordFormValues>();
  const changePassword = useChangePassword();

  async function onFinish(values: PasswordFormValues): Promise<void> {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      form.resetFields();
      message.success('Password changed');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to change password');
    }
  }

  return (
    <Card>
      <Typography.Title level={4}>Change Password</Typography.Title>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Changing your password will not sign you out elsewhere"
        description="Sessions already signed in on other devices stay signed in until they expire. If you think someone else has your password, ask HR to deactivate the account."
      />
      <Form form={form} layout="vertical" onFinish={onFinish} style={{ maxWidth: 420 }}>
        <Form.Item
          name="currentPassword"
          label="Current Password"
          rules={[{ required: true, message: 'Please enter your current password' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New Password"
          rules={[
            { required: true, message: 'Please enter a new password' },
            { min: 6, message: 'Password must be at least 6 characters' },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm the new password' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('The two passwords do not match')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={changePassword.isPending}>
            Change Password
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

function ProfileCard({ employeeId }: { employeeId: number }) {
  const { data: employee, isLoading, isError } = useEmployee(employeeId);

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

export default function ProfilePage() {
  const { user } = useAuth();
  const employeeId = user?.employee?.id;

  return (
    <Space direction="vertical" size={16} style={{ display: 'flex' }}>
      {employeeId && <ProfileCard employeeId={employeeId} />}
      {/* An unlinked HR account is the normal case, so only an employee missing their
          profile is worth warning about. */}
      {!employeeId && user?.roleName !== 'HR' && (
        <Result status="warning" title="No employee profile is linked to this account." />
      )}
      <ChangePasswordCard />
    </Space>
  );
}
