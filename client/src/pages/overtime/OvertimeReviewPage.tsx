import { useState } from 'react';
import { Card, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import {
  useOvertime,
  useReviewOvertime,
  requestStatusColor,
  type Overtime,
  type RequestStatus,
} from '../../api/overtime';
import { formatDate } from '../../lib/format';

export default function OvertimeReviewPage() {
  const [status, setStatus] = useState<RequestStatus | undefined>();
  const [rejecting, setRejecting] = useState<Overtime | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { data, isLoading } = useOvertime({ status, pageSize: 100 });
  const reviewOvertime = useReviewOvertime();

  async function handleApprove(record: Overtime): Promise<void> {
    try {
      await reviewOvertime.mutateAsync({ id: record.id, payload: { action: 'APPROVE' } });
      message.success('Overtime approved');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to approve');
    }
  }

  async function handleReject(): Promise<void> {
    if (!rejecting) return;
    try {
      await reviewOvertime.mutateAsync({
        id: rejecting.id,
        payload: { action: 'REJECT', rejectReason },
      });
      message.success('Overtime rejected');
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to reject');
    }
  }

  const columns: ColumnsType<Overtime> = [
    {
      title: 'Employee',
      render: (_value, record) => record.employeeNickname ?? record.employeeName ?? '-',
    },
    { title: 'Date', dataIndex: 'date', render: (value: string) => formatDate(value), width: 140 },
    { title: 'Hours', dataIndex: 'hours', width: 90 },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | null) => value ?? '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: Overtime['status'], record) => (
        <Tag color={requestStatusColor[value]} title={record.rejectReason ?? undefined}>
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

      <Table<Overtime>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />

      <Modal
        title="Reject Overtime"
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onOk={handleReject}
        confirmLoading={reviewOvertime.isPending}
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
