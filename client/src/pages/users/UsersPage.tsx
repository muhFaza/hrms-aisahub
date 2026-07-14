import { useMemo, useState } from 'react';
import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useRoles, useUsers, type UserRow } from '../../api/users';
import { useEmployees } from '../../api/employees';
import { formatDate } from '../../lib/format';
import UserFormModal from './UserFormModal';

export default function UsersPage() {
  const { data: users, isLoading } = useUsers();
  const { data: roles } = useRoles();
  const { data: employeesResponse } = useEmployees({ pageSize: 100 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const employees = employeesResponse?.data ?? [];
  const linkedEmployeeIds = useMemo(
    () => (users ?? []).map((user) => user.employeeId).filter((id): id is number => id !== null),
    [users],
  );

  function openCreate(): void {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(user: UserRow): void {
    setEditing(user);
    setModalOpen(true);
  }

  const columns: ColumnsType<UserRow> = [
    { title: 'Email', dataIndex: 'email' },
    {
      title: 'Role',
      dataIndex: 'roleName',
      render: (value: string) => <Tag color={value === 'HR' ? 'geekblue' : 'green'}>{value}</Tag>,
    },
    {
      title: 'Linked Employee',
      dataIndex: 'employeeName',
      render: (value: string | null) => value ?? '-',
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>{value ? 'Active' : 'Inactive'}</Tag>
      ),
    },
    { title: 'Created', dataIndex: 'createdAt', render: (value: string) => formatDate(value) },
    {
      title: 'Actions',
      width: 100,
      render: (_value, record) => <a onClick={() => openEdit(record)}>Edit</a>,
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Users
        </Typography.Title>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New User
          </Button>
        </Space>
      </div>

      <Table<UserRow>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={users ?? []}
        pagination={false}
      />

      <UserFormModal
        open={modalOpen}
        user={editing}
        roles={roles ?? []}
        employees={employees}
        linkedEmployeeIds={linkedEmployeeIds}
        onClose={() => setModalOpen(false)}
      />
    </Card>
  );
}
