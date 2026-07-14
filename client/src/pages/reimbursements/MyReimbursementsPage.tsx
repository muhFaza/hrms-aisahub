import { useState } from 'react';
import { Button, Card, Popconfirm, Table, Tag, Typography, message } from 'antd';
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useReimbursements,
  useCancelReimbursement,
  downloadEvidence,
  type Reimbursement,
} from '../../api/reimbursements';
import { requestStatusColor } from '../../api/overtime';
import { formatDate, formatIDR } from '../../lib/format';
import SubmitReimbursementModal from './SubmitReimbursementModal';

export default function MyReimbursementsPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useReimbursements({ pageSize: 100 });
  const cancelReimbursement = useCancelReimbursement();

  async function handleCancel(id: number): Promise<void> {
    try {
      await cancelReimbursement.mutateAsync(id);
      message.success('Reimbursement cancelled');
    } catch {
      message.error('Failed to cancel reimbursement');
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
            <DownloadOutlined /> Download
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
      width: 100,
      render: (_value, record) =>
        record.status === 'PENDING' ? (
          <Popconfirm title="Cancel this reimbursement?" onConfirm={() => handleCancel(record.id)}>
            <a style={{ color: '#ff4d4f' }}>Cancel</a>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Card
      title={
        <Typography.Title level={5} style={{ margin: 0 }}>
          My Reimbursements
        </Typography.Title>
      }
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Submit Reimbursement
        </Button>
      }
    >
      <Table<Reimbursement>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />

      <SubmitReimbursementModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Card>
  );
}
