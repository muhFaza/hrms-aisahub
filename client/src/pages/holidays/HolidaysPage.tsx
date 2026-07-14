import { useState } from 'react';
import { Button, Card, List, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
  useHolidays,
  useDeleteHoliday,
  holidayTypeColor,
  holidayTypeLabel,
  type Holiday,
} from '../../api/holidays';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../lib/AuthContext';
import LeaveCalendar from '../../components/LeaveCalendar';
import HolidayFormModal from './HolidayFormModal';

const currentYear = dayjs().year();
const yearOptions = Array.from({ length: 5 }, (_, index) => currentYear - 2 + index).map((year) => ({
  value: year,
  label: String(year),
}));

// HR manages holidays; employees get a read-only list plus the shared calendar (design §6).
export default function HolidaysPage() {
  const { user } = useAuth();
  const isHR = user?.roleName === 'HR';
  const [year, setYear] = useState(currentYear);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const { data: holidays, isLoading } = useHolidays(year);
  const deleteHoliday = useDeleteHoliday();

  function openCreate(): void {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(holiday: Holiday): void {
    setEditing(holiday);
    setModalOpen(true);
  }

  async function handleDelete(id: number): Promise<void> {
    try {
      await deleteHoliday.mutateAsync(id);
      message.success('Holiday deleted');
    } catch {
      message.error('Failed to delete holiday');
    }
  }

  const columns: ColumnsType<Holiday> = [
    { title: 'Date', dataIndex: 'date', render: (value: string) => formatDate(value), width: 160 },
    { title: 'Name', dataIndex: 'name' },
    {
      title: 'Type',
      dataIndex: 'type',
      width: 140,
      render: (value: Holiday['type']) => (
        <Tag color={holidayTypeColor[value]}>{holidayTypeLabel[value]}</Tag>
      ),
    },
    { title: 'Notes', dataIndex: 'notes', render: (value: string | null) => value ?? '-' },
  ];

  if (isHR) {
    columns.push({
      title: 'Actions',
      width: 140,
      render: (_value, record) => (
        <Space>
          <a onClick={() => openEdit(record)}>Edit</a>
          <Popconfirm
            title="Delete this holiday?"
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <a style={{ color: '#ff4d4f' }}>Delete</a>
          </Popconfirm>
        </Space>
      ),
    });
  }

  const yearSelector = (
    <Select value={year} onChange={setYear} options={yearOptions} style={{ width: 120 }} />
  );

  // Employee view: read-only calendar + upcoming-holidays list.
  if (!isHR) {
    const upcoming = (holidays ?? []).filter((holiday) => !dayjs(holiday.date).isBefore(dayjs(), 'day'));
    return (
      <Tabs
        items={[
          {
            key: 'calendar',
            label: 'Calendar',
            children: <LeaveCalendar />,
          },
          {
            key: 'list',
            label: 'Holidays',
            children: (
              <Card
                title="Upcoming Holidays"
                extra={yearSelector}
                loading={isLoading}
              >
                <List
                  dataSource={upcoming}
                  locale={{ emptyText: 'No upcoming holidays' }}
                  renderItem={(holiday) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            <span>{holiday.name}</span>
                            <Tag color={holidayTypeColor[holiday.type]}>
                              {holidayTypeLabel[holiday.type]}
                            </Tag>
                          </Space>
                        }
                        description={formatDate(holiday.date)}
                      />
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
        ]}
      />
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Holidays
        </Typography.Title>
        <Space>
          {yearSelector}
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            New Holiday
          </Button>
        </Space>
      </div>

      <Table<Holiday>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={holidays ?? []}
        pagination={false}
      />

      <HolidayFormModal open={modalOpen} holiday={editing} onClose={() => setModalOpen(false)} />
    </Card>
  );
}
