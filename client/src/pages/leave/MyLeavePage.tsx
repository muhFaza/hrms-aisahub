import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useLeaveBalance,
  useLeaveRequests,
  useCancelLeave,
  leaveStatusColor,
  leaveTypeColor,
  type LeaveRequest,
} from '../../api/leave';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../lib/AuthContext';
import LeaveCalendar from '../../components/LeaveCalendar';
import RequestLeaveModal from './RequestLeaveModal';

function BalanceTab({ isFullTime }: { isFullTime: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { data: balance } = useLeaveBalance();
  const { data: requests, isLoading } = useLeaveRequests({ pageSize: 100 });
  const cancelLeave = useCancelLeave();

  async function handleCancel(id: number): Promise<void> {
    try {
      await cancelLeave.mutateAsync(id);
      message.success('Request cancelled');
    } catch {
      message.error('Failed to cancel request');
    }
  }

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: 'Type',
      dataIndex: 'type',
      render: (value: LeaveRequest['type']) => <Tag color={leaveTypeColor[value]}>{value}</Tag>,
    },
    {
      title: 'Dates',
      render: (_value, record) => `${formatDate(record.startDate)} — ${formatDate(record.endDate)}`,
    },
    { title: 'Working Days', dataIndex: 'totalDays', width: 120 },
    { title: 'Reason', dataIndex: 'reason', render: (value: string | null) => value ?? '-' },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: LeaveRequest['status'], record) =>
        value === 'REJECTED' && record.rejectReason ? (
          <Tag color={leaveStatusColor[value]} title={record.rejectReason}>
            {value}
          </Tag>
        ) : (
          <Tag color={leaveStatusColor[value]}>{value}</Tag>
        ),
    },
    {
      title: 'Actions',
      width: 100,
      render: (_value, record) =>
        record.status === 'PENDING' ? (
          <Popconfirm title="Cancel this request?" onConfirm={() => handleCancel(record.id)}>
            <a style={{ color: '#ff4d4f' }}>Cancel</a>
          </Popconfirm>
        ) : null,
    },
  ];

  const expiringSoonDays = (balance?.expiringSoon ?? []).reduce((sum, row) => sum + row.days, 0);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="Balance" value={balance?.balance ?? 0} suffix="days" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Used" value={balance?.usedTotal ?? 0} suffix="days" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Sick Taken" value={balance?.sickTaken ?? 0} suffix="days" />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Expired" value={balance?.expiredTotal ?? 0} suffix="days" />
          </Card>
        </Col>
      </Row>

      {expiringSoonDays > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${expiringSoonDays} paid-leave day(s) expiring within 60 days`}
          description={balance?.expiringSoon
            .map((row) => `${row.days} day(s) on ${formatDate(row.expiresAt)}`)
            .join(', ')}
        />
      )}

      <Card
        title={
          <Typography.Title level={5} style={{ margin: 0 }}>
            Request History
          </Typography.Title>
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            Request Leave
          </Button>
        }
      >
        <Table<LeaveRequest>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={requests?.data ?? []}
          pagination={false}
        />
      </Card>

      <RequestLeaveModal
        open={modalOpen}
        isFullTime={isFullTime}
        onClose={() => setModalOpen(false)}
      />
    </Space>
  );
}

export default function MyLeavePage() {
  const { user } = useAuth();
  const isFullTime = user?.employee?.employmentType === 'FULL_TIME';

  return (
    <Tabs
      items={[
        { key: 'balance', label: 'My Leave', children: <BalanceTab isFullTime={isFullTime} /> },
        { key: 'calendar', label: 'Calendar', children: <LeaveCalendar /> },
      ]}
    />
  );
}
