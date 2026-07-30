import { useEffect, useMemo } from 'react';
import { Form, Input, Modal, Select, Switch, message } from 'antd';
import { AxiosError } from 'axios';
import { useCreateUser, useUpdateUser, type Role, type UserRow } from '../../api/users';
import type { Employee } from '../../api/employees';

interface UserFormValues {
  email: string;
  password?: string;
  roleId: number;
  employeeId?: number | null;
  isActive: boolean;
}

interface Props {
  open: boolean;
  user: UserRow | null;
  roles: Role[];
  employees: Employee[];
  linkedEmployeeIds: number[];
  onClose: () => void;
}

export default function UserFormModal({
  open,
  user,
  roles,
  employees,
  linkedEmployeeIds,
  onClose,
}: Props) {
  const [form] = Form.useForm<UserFormValues>();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const isEdit = user !== null;

  // Only employees without an account can be linked; keep the user's current link visible on edit.
  const employeeOptions = useMemo(() => {
    const linked = new Set(linkedEmployeeIds);
    return employees
      .filter((employee) => !linked.has(employee.id) || employee.id === user?.employeeId)
      .map((employee) => ({ value: employee.id, label: `${employee.fullName} (${employee.position})` }));
  }, [employees, linkedEmployeeIds, user]);

  const roleOptions = useMemo(
    () => roles.map((role) => ({ value: role.id, label: role.name })),
    [roles],
  );

  useEffect(() => {
    if (!open) return;
    if (user) {
      form.setFieldsValue({
        roleId: user.roleId,
        employeeId: user.employeeId,
        isActive: user.isActive,
        password: undefined,
      });
    } else {
      form.resetFields();
      const employeeRole = roles.find((role) => role.name === 'EMPLOYEE');
      form.setFieldsValue({ isActive: true, roleId: employeeRole?.id });
    }
  }, [open, user, roles, form]);

  async function onFinish(values: UserFormValues): Promise<void> {
    try {
      if (user) {
        // roleId is omitted on purpose — role is fixed at creation.
        await updateUser.mutateAsync({
          id: user.id,
          payload: {
            isActive: values.isActive,
            employeeId: values.employeeId ?? null,
            ...(values.password ? { password: values.password } : {}),
          },
        });
        message.success('User updated');
      } else {
        await createUser.mutateAsync({
          email: values.email,
          password: values.password ?? '',
          roleId: values.roleId,
          employeeId: values.employeeId ?? null,
        });
        message.success('User created');
      }
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to save user');
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit User' : 'New User'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={createUser.isPending || updateUser.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        {!isEdit && (
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
        )}
        <Form.Item
          name="password"
          label={isEdit ? 'Reset Password (optional)' : 'Password'}
          rules={isEdit ? [{ min: 6 }] : [{ required: true, min: 6 }]}
        >
          <Input.Password placeholder={isEdit ? 'Leave blank to keep current' : ''} />
        </Form.Item>
        {/* Shown but locked when editing: the role a user was created with is final. */}
        <Form.Item
          name="roleId"
          label="Role"
          rules={[{ required: true }]}
          extra={isEdit ? 'Role cannot be changed after the account is created.' : undefined}
        >
          <Select options={roleOptions} disabled={isEdit} />
        </Form.Item>
        <Form.Item name="employeeId" label="Linked Employee">
          <Select allowClear placeholder="No linked employee" options={employeeOptions} />
        </Form.Item>
        {isEdit && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
