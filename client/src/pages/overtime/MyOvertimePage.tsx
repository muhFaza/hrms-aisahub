import { useState } from 'react';
import { Button, Card, Popconfirm, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useOvertime,
  useCancelOvertime,
  requestStatusColor,
  type Overtime,
} from '../../api/overtime';
import { formatDate } from '../../lib/format';
import SubmitOvertimeModal from './SubmitOvertimeModal';

export default function MyOvertimePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const { data, isLoading } = useOvertime({ pageSize: 100 });
  const cancelOvertime = useCancelOvertime();

  async function handleCancel(id: number): Promise<void> {
    try {
      await cancelOvertime.mutateAsync(id);
      message.success('Overtime cancelled');
    } catch {
      message.error('Failed to cancel overtime');
    }
  }

  const columns: ColumnsType<Overtime> = [
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
      width: 100,
      render: (_value, record) =>
        record.status === 'PENDING' ? (
          <Popconfirm title="Cancel this overtime?" onConfirm={() => handleCancel(record.id)}>
            <a style={{ color: '#ff4d4f' }}>Cancel</a>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Card
      title={
        <Typography.Title level={5} style={{ margin: 0 }}>
          My Overtime
        </Typography.Title>
      }
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Submit Overtime
        </Button>
      }
    >
      <Table<Overtime>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data?.data ?? []}
        pagination={false}
      />

      <SubmitOvertimeModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </Card>
  );
}
