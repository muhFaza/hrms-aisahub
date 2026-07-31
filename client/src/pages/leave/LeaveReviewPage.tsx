import { useRef, useState } from 'react';
import { Card, Popconfirm, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import {
  useLeaveRequests,
  useLeaveBalances,
  useCancelLeave,
  leaveTypeColor,
  type LeaveRequest,
  type LeaveBalanceSummary,
} from '../../api/leave';
import { formatDate } from '../../lib/format';
import LeaveCalendar from '../../components/LeaveCalendar';

function AllLeaveTab() {
  const { data, isLoading } = useLeaveRequests({ pageSize: 100 });
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
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to cancel leave');
    } finally {
      inFlight.current = null;
      setCancellingId(null);
    }
  }

  const columns: ColumnsType<LeaveRequest> = [
    {
      title: 'Employee',
      render: (_value, record) => record.employeeNickname ?? record.employeeName ?? '-',
    },
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
      // HR's override correction — unlike the employee's own page this is not limited to
      // future leave, so a past-dated record can still be unwound.
      title: 'Actions',
      width: 100,
      render: (_value, record) => {
        const busy = cancellingId !== null;
        return (
          <Popconfirm
            title="Cancel this leave?"
            description="Paid leave days are refunded to the employee's balance."
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

  return (
    <Card>
      <Table<LeaveRequest>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />
    </Card>
  );
}

function BalancesTab() {
  const { data, isLoading } = useLeaveBalances();

  const columns: ColumnsType<LeaveBalanceSummary> = [
    { title: 'Employee', dataIndex: 'employeeName' },
    { title: 'Balance', dataIndex: 'balance', width: 110 },
    { title: 'Accrued', dataIndex: 'accrued', width: 110 },
    { title: 'Used', dataIndex: 'used', width: 100 },
    { title: 'Expired', dataIndex: 'expired', width: 100 },
    { title: 'Sick Taken', dataIndex: 'sickTaken', width: 120 },
  ];

  return (
    <Card>
      <Table<LeaveBalanceSummary>
        rowKey="employeeId"
        loading={isLoading}
        columns={columns}
        dataSource={data ?? []}
        pagination={false}
      />
    </Card>
  );
}

export default function LeaveReviewPage() {
  return (
    <Tabs
      items={[
        { key: 'all', label: 'All Leave', children: <AllLeaveTab /> },
        { key: 'balances', label: 'Balances', children: <BalancesTab /> },
        { key: 'calendar', label: 'Calendar', children: <LeaveCalendar /> },
      ]}
    />
  );
}
