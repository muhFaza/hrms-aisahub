import { useState } from 'react';
import { Card, Form, Input, Modal, Select, Space, Table, Tag, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import {
  useReimbursements,
  useReviewReimbursement,
  downloadEvidence,
  type Reimbursement,
} from '../../api/reimbursements';
import { requestStatusColor, type RequestStatus } from '../../api/overtime';
import { formatDate, formatIDR } from '../../lib/format';

export default function ReimbursementsReviewPage() {
  const [status, setStatus] = useState<RequestStatus | undefined>();
  const [rejecting, setRejecting] = useState<Reimbursement | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const { data, isLoading } = useReimbursements({ status, pageSize: 100 });
  const reviewReimbursement = useReviewReimbursement();

  async function handleApprove(record: Reimbursement): Promise<void> {
    try {
      await reviewReimbursement.mutateAsync({ id: record.id, payload: { action: 'APPROVE' } });
      message.success('Reimbursement approved');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to approve');
    }
  }

  async function handleReject(): Promise<void> {
    if (!rejecting) return;
    try {
      await reviewReimbursement.mutateAsync({
        id: rejecting.id,
        payload: { action: 'REJECT', rejectReason },
      });
      message.success('Reimbursement rejected');
      setRejecting(null);
      setRejectReason('');
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to reject');
    }
  }

  async function handleDownload(record: Reimbursement): Promise<void> {
    try {
      await downloadEvidence(record.id, record.evidenceFilePath ?? `evidence-${record.id}`);
    } catch {
      message.error('Failed to download evidence');
    }
  }

  const columns: ColumnsType<Reimbursement> = [
    {
      title: 'Employee',
      render: (_value, record) => record.employeeNickname ?? record.employeeName ?? '-',
    },
    { title: 'Date', dataIndex: 'date', render: (value: string) => formatDate(value), width: 140 },
    {
      title: 'Amount',
      dataIndex: 'amount',
      render: (value: number) => formatIDR(value),
      width: 160,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | null) => value ?? '-',
    },
    {
      title: 'Evidence',
      width: 120,
      render: (_value, record) =>
        record.evidenceFilePath ? (
          <a onClick={() => handleDownload(record)}>
            <DownloadOutlined /> View
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: Reimbursement['status'], record) => (
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

      <Table<Reimbursement>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />

      <Modal
        title="Reject Reimbursement"
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onOk={handleReject}
        confirmLoading={reviewReimbursement.isPending}
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
