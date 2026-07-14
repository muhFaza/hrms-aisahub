import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  DatePicker,
  Popconfirm,
  Row,
  Space,
  Statistic,
  Table,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useDailyLogs, useDeleteDailyLog, type DailyLog } from '../../api/dailyLogs';
import { formatDate } from '../../lib/format';
import DailyLogModal from './DailyLogModal';

export default function MyDailyLogPage() {
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DailyLog | null>(null);

  const monthKey = month.format('YYYY-MM');
  const { data, isLoading } = useDailyLogs({ month: monthKey, pageSize: 100 });
  const deleteLog = useDeleteDailyLog();

  const logs = data?.data ?? [];
  const totalHours = logs.reduce((sum, log) => sum + log.hours, 0);

  function openCreate(): void {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(log: DailyLog): void {
    setEditing(log);
    setModalOpen(true);
  }

  async function handleDelete(id: number): Promise<void> {
    try {
      await deleteLog.mutateAsync(id);
      message.success('Daily log deleted');
    } catch {
      message.error('Failed to delete daily log');
    }
  }

  const columns: ColumnsType<DailyLog> = [
    { title: 'Date', dataIndex: 'date', render: (value: string) => formatDate(value), width: 140 },
    { title: 'Hours', dataIndex: 'hours', width: 90 },
    { title: 'Project', dataIndex: 'project', render: (value: string | null) => value ?? '-' },
    { title: 'Notes', dataIndex: 'notes', render: (value: string | null) => value ?? '-' },
    {
      title: 'Actions',
      width: 140,
      render: (_value, record) => (
        <Space>
          <a onClick={() => openEdit(record)}>Edit</a>
          <Popconfirm title="Delete this log?" onConfirm={() => handleDelete(record.id)}>
            <a style={{ color: '#ff4d4f' }}>Delete</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="Total Hours This Month" value={totalHours} suffix="h" />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="Logged Days" value={logs.length} />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Typography.Title level={5} style={{ margin: 0 }}>
            Daily Logs
          </Typography.Title>
        }
        extra={
          <Space>
            <DatePicker
              picker="month"
              value={month}
              onChange={(value) => value && setMonth(value)}
              allowClear={false}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              Log Activity
            </Button>
          </Space>
        }
      >
        <Table<DailyLog>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={logs}
          pagination={false}
        />
      </Card>

      <DailyLogModal open={modalOpen} log={editing} onClose={() => setModalOpen(false)} />
    </Space>
  );
}
