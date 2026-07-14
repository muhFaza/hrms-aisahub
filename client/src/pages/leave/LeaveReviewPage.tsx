import { useState } from 'react';
import { Card, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import {
  useLeaveRequests,
  useLeaveBalances,
  useReviewLeave,
  leaveStatusColor,
  leaveTypeColor,
  type LeaveRequest,
  type LeaveStatus,
  type LeaveBalanceSummary,
} from '../../api/leave';
import { formatDate } from '../../lib/format';
import LeaveCalendar from '../../components/LeaveCalendar';

function RequestsTab() {
  const [status, setStatus] = useState<LeaveStatus | undefined>();
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { data, isLoading } = useLeaveRequests({ status, pageSize: 100 });
  const reviewLeave = useReviewLeave();

  async function handleApprove(record: LeaveRequest): Promise<void> {
    try {
      await reviewLeave.mutateAsync({ id: record.id, payload: { action: 'APPROVE' } });
      message.success('Request approved');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to approve');
    }
  }

  async function handleReject(): Promise<void> {
    if (!rejecting) return;
    try {
      await reviewLeave.mutateAsync({
        id: rejecting.id,
        payload: { action: 'REJECT', rejectReason },
      });
      message.success('Request rejected');
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to reject');
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
      title: 'Status',
      dataIndex: 'status',
      render: (value: LeaveRequest['status'], record) => (
        <Tag color={leaveStatusColor[value]} title={record.rejectReason ?? undefined}>
          {value}
        </Tag>
      ),
    },
    {
      title: 'Actions',
      width: 160,
      render: (_value, record) =>
        record.status === 'PENDING' ? (
          <Space>
            <a onClick={() => handleApprove(record)}>Approve</a>
            <a style={{ color: '#ff4d4f' }} onClick={() => setRejecting(record)}>
              Reject
            </a>
          </Space>
        ) : null,
    },
  ];

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="Filter status"
          style={{ width: 180 }}
          value={status}
          onChange={setStatus}
          options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />
      </Space>

      <Table<LeaveRequest>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />

      <Modal
        title="Reject Leave Request"
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onOk={handleReject}
        confirmLoading={reviewLeave.isPending}
        okButtonProps={{ danger: true, disabled: !rejectReason.trim() }}
        okText="Reject"
      >
        <Form layout="vertical">
          <Form.Item label="Reason for rejection" required>
            <Input.TextArea
              rows={3}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
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
        { key: 'requests', label: 'Requests', children: <RequestsTab /> },
        { key: 'balances', label: 'Balances', children: <BalancesTab /> },
        { key: 'calendar', label: 'Calendar', children: <LeaveCalendar /> },
      ]}
    />
  );
}
