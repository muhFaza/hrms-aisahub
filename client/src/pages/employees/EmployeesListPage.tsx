import { useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { useEmployees, type Employee } from '../../api/employees';
import type { EmploymentType } from '../../api/auth';
import { formatDate } from '../../lib/format';
import EmployeeFormDrawer from './EmployeeFormDrawer';

export default function EmployeesListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);

  const { data, isLoading } = useEmployees({
    search: search || undefined,
    employmentType,
    page,
    pageSize,
  });

  function openCreate(): void {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(employee: Employee): void {
    setEditing(employee);
    setDrawerOpen(true);
  }

  const columns: ColumnsType<Employee> = [
    {
      title: 'Name',
      dataIndex: 'fullName',
      render: (_value, record) => (
        <a onClick={() => navigate(`/employees/${record.id}`)}>{record.fullName}</a>
      ),
    },
    { title: 'Position', dataIndex: 'position' },
    {
      title: 'Type',
      dataIndex: 'employmentType',
      render: (value: EmploymentType) => (
        <Tag color={value === 'FULL_TIME' ? 'blue' : 'gold'}>
          {value === 'FULL_TIME' ? 'Full-time' : 'Part-time'}
        </Tag>
      ),
    },
    {
      title: 'Contract',
      render: (_value, record) =>
        `${formatDate(record.contractStartDate)} — ${formatDate(record.contractEndDate)}`,
    },
    {
      title: 'Status',
      dataIndex: 'isActive',
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'red'}>{value ? 'Active' : 'Inactive'}</Tag>
      ),
    },
    {
      title: 'Actions',
      render: (_value, record) => (
        <Space>
          <a onClick={() => navigate(`/employees/${record.id}`)}>View</a>
          <a onClick={() => openEdit(record)}>Edit</a>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Employees
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          New Employee
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          allowClear
          placeholder="Search name or email"
          style={{ width: 260 }}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder="Employment type"
          style={{ width: 180 }}
          value={employmentType}
          onChange={(value) => {
            setEmploymentType(value);
            setPage(1);
          }}
          options={[
            { value: 'FULL_TIME', label: 'Full-time' },
            { value: 'PART_TIME', label: 'Part-time' },
          ]}
        />
      </Space>

      <Table<Employee>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />

      <EmployeeFormDrawer
        open={drawerOpen}
        employee={editing}
        onClose={() => setDrawerOpen(false)}
      />
    </Card>
  );
}
