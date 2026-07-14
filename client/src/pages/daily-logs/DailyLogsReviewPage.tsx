import { useMemo, useState } from 'react';
import { Card, DatePicker, Popconfirm, Select, Space, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useDailyLogs, useDeleteDailyLog, type DailyLog } from '../../api/dailyLogs';
import { useEmployees } from '../../api/employees';
import { formatDate } from '../../lib/format';
import DailyLogModal from './DailyLogModal';

export default function DailyLogsReviewPage() {
  const [employeeId, setEmployeeId] = useState<number | undefined>();
  const [month, setMonth] = useState<Dayjs>(dayjs());
  const [editing, setEditing] = useState<DailyLog | null>(null);

  const monthKey = month.format('YYYY-MM');
  const { data, isLoading } = useDailyLogs({ employeeId, month: monthKey, pageSize: 100 });
  const { data: employees } = useEmployees({ employmentType: 'PART_TIME', pageSize: 100 });
  const deleteLog = useDeleteDailyLog();

  const logs = data?.data ?? [];

  // Per-employee total hours for the selected month.
  const totalsByEmployee = useMemo(() => {
    const map = new Map<string, number>();
    for (const log of data?.data ?? []) {
      const name = log.employeeNickname ?? log.employeeName ?? `#${log.employeeId}`;
      map.set(name, (map.get(name) ?? 0) + log.hours);
    }
    return [...map.entries()];
  }, [data]);

  async function handleDelete(id: number): Promise<void> {
    try {
      await deleteLog.mutateAsync(id);
      message.success('Daily log deleted');
    } catch {
      message.error('Failed to delete daily log');
    }
  }

  const columns: ColumnsType<DailyLog> = [
    {
      title: 'Employee',
      render: (_value, record) => record.employeeNickname ?? record.employeeName ?? '-',
    },
    { title: 'Date', dataIndex: 'date', render: (value: string) => formatDate(value), width: 140 },
    { title: 'Hours', dataIndex: 'hours', width: 90 },
    { title: 'Project', dataIndex: 'project', render: (value: string | null) => value ?? '-' },
    { title: 'Notes', dataIndex: 'notes', render: (value: string | null) => value ?? '-' },
    {
      title: 'Actions',
      width: 140,
      render: (_value, record) => (
        <Space>
          <a onClick={() => setEditing(record)}>Edit</a>
          <Popconfirm title="Delete this log?" onConfirm={() => handleDelete(record.id)}>
            <a style={{ color: '#ff4d4f' }}>Delete</a>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter employee"
          style={{ width: 220 }}
          value={employeeId}
          onChange={setEmployeeId}
          options={(employees?.data ?? []).map((employee) => ({
            value: employee.id,
            label: employee.nickname ?? employee.fullName,
          }))}
        />
        <DatePicker
          picker="month"
          value={month}
          onChange={(value) => value && setMonth(value)}
          allowClear={false}
        />
      </Space>

      {totalsByEmployee.length > 0 && (
        <Typography.Paragraph type="secondary">
          Monthly totals:{' '}
          {totalsByEmployee.map(([name, hours]) => `${name}: ${hours}h`).join('  ·  ')}
        </Typography.Paragraph>
      )}

      <Table<DailyLog>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={logs}
        pagination={false}
      />

      <DailyLogModal open={editing !== null} log={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}
