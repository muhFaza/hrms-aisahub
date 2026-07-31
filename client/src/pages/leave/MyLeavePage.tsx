import { useRef, useState } from 'react';
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
import dayjs from 'dayjs';
import {
  useLeaveBalance,
  useLeaveRequests,
  useCancelLeave,
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
  // One DELETE at a time. The ref guards independently of render timing — the state alone is
  // stale inside a click handler's closure, and a second DELETE 404s and toasts a false failure.
  const inFlight = useRef<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  async function handleCancel(id: number): Promise<void> {
    if (inFlight.current !== null) return;
    inFlight.current = id;
    setCancellingId(id);
    try {
      await cancelLeave.mutateAsync(id);
      message.success('Leave cancelled');
    } catch {
      message.error('Failed to cancel leave');
    } finally {
      inFlight.current = null;
      setCancellingId(null);
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
      // The server only allows self-cancellation up to and including the start date; the
      // stored date is a UTC calendar day, so compare day strings rather than instants.
      title: 'Actions',
      width: 100,
      render: (_value, record) => {
        if (dayjs().format('YYYY-MM-DD') > record.startDate.slice(0, 10)) return null;
        const busy = cancellingId !== null;
        return (
          <Popconfirm
            title="Cancel this leave?"
            description="Paid leave days are refunded to your balance."
            okButtonProps={{ loading: cancellingId === record.id }}
            onConfirm={() => handleCancel(record.id)}
          >
            {/* A disabled-looking <a> still fires onClick, so the trigger is made inert. */}
            <a style={{ color: busy ? undefined : '#ff4d4f', pointerEvents: busy ? 'none' : undefined }}>
              Cancel
            </a>
          </Popconfirm>
        );
      },
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
