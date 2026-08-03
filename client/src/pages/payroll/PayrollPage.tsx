import { useState } from 'react';
import { Alert, Button, Card, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router-dom';
import {
  useCreatePeriod,
  usePayrollPeriods,
  payrollStatusColor,
  rateSourceColor,
  type PayrollPeriod,
} from '../../api/payroll';
import { formatIDR, formatPeriod } from '../../lib/format';

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: formatPeriod(2000, i + 1).split(' ')[0],
}));

function defaultPeriodRange(year: number, month: number): { start: Dayjs; end: Dayjs } {
  const end = dayjs().date(1).year(year).month(month - 1).date(25).startOf('day');
  return { start: end.subtract(1, 'month').date(26), end };
}

export default function PayrollPage() {
  const navigate = useNavigate();
  const now = new Date();
  const [modalOpen, setModalOpen] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const initialRange = defaultPeriodRange(now.getFullYear(), now.getMonth() + 1);
  const [startPeriod, setStartPeriod] = useState<Dayjs | null>(initialRange.start);
  const [endPeriod, setEndPeriod] = useState<Dayjs | null>(initialRange.end);
  const { data, isLoading } = usePayrollPeriods();
  const createPeriod = useCreatePeriod();

  async function handleCreate(): Promise<void> {
    if (!startPeriod || !endPeriod || endPeriod.isBefore(startPeriod, 'day')) return;
    try {
      const created = await createPeriod.mutateAsync({
        year,
        month,
        startDate: startPeriod.format('YYYY-MM-DD'),
        endDate: endPeriod.format('YYYY-MM-DD'),
      });
      setModalOpen(false);
      if (created.rateSource === 'FALLBACK') {
        message.warning('Live FX rate unavailable — a fallback rate was applied. Edit it before finalizing.');
      } else {
        message.success('Payroll period created');
      }
      navigate(`/payroll/${created.id}`);
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to create period');
    }
  }

  function updateRange(nextYear: number, nextMonth: number): void {
    const range = defaultPeriodRange(nextYear, nextMonth);
    setStartPeriod(range.start);
    setEndPeriod(range.end);
  }

  const invalidRange = Boolean(
    startPeriod && endPeriod && endPeriod.isBefore(startPeriod, 'day'),
  );
  const createDisabled = !startPeriod || !endPeriod || invalidRange;

  const columns: ColumnsType<PayrollPeriod> = [
    {
      title: 'Period',
      render: (_value, record) => formatPeriod(record.year, record.month),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value: PayrollPeriod['status']) => <Tag color={payrollStatusColor[value]}>{value}</Tag>,
    },
    {
      title: 'Exchange rate',
      render: (_value, record) => (
        <Space>
          {formatIDR(record.exchangeRate)}
          <Tag color={rateSourceColor[record.rateSource]}>{record.rateSource}</Tag>
        </Space>
      ),
    },
    { title: 'Payslips', dataIndex: 'payslipCount', width: 100 },
    {
      title: 'Actions',
      width: 120,
      render: (_value, record) => <a onClick={() => navigate(`/payroll/${record.id}`)}>Open</a>,
    },
  ];

  return (
    <Card
      title={
        <Typography.Title level={5} style={{ margin: 0 }}>
          Payroll Periods
        </Typography.Title>
      }
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          New Period
        </Button>
      }
    >
      <Table<PayrollPeriod>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data ?? []}
        pagination={false}
        onRow={(record) => ({ onClick: () => navigate(`/payroll/${record.id}`), style: { cursor: 'pointer' } })}
      />

      <Modal
        title="New Payroll Period"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleCreate}
        confirmLoading={createPeriod.isPending}
        okText="Create"
        okButtonProps={{ disabled: createDisabled }}
      >
        <Alert
          type="info"
          style={{ marginBottom: 16 }}
          message="The live USD→IDR rate is fetched on creation. If unavailable a fallback rate is applied, which you can edit before finalizing."
        />
        <Form layout="vertical">
          <Form.Item label="Year">
            <InputNumber
              min={2000}
              max={2100}
              value={year}
              onChange={(value) => {
                const nextYear = value ?? now.getFullYear();
                setYear(nextYear);
                updateRange(nextYear, month);
              }}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="Month">
            <Select
              value={month}
              onChange={(nextMonth) => {
                setMonth(nextMonth);
                updateRange(year, nextMonth);
              }}
              options={MONTH_OPTIONS}
            />
          </Form.Item>
          <Form.Item label="Start Period" required>
            <DatePicker
              value={startPeriod}
              onChange={setStartPeriod}
              format="DD MMM YYYY"
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item
            label="End Period"
            required
            validateStatus={invalidRange ? 'error' : undefined}
            help={invalidRange ? 'End Period must be on or after Start Period' : undefined}
          >
            <DatePicker
              value={endPeriod}
              onChange={setEndPeriod}
              format="DD MMM YYYY"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
