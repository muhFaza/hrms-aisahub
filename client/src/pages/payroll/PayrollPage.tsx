import { useState } from 'react';
import { Alert, Button, Card, Form, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
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

export default function PayrollPage() {
  const navigate = useNavigate();
  const now = new Date();
  const [modalOpen, setModalOpen] = useState(false);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const { data, isLoading } = usePayrollPeriods();
  const createPeriod = useCreatePeriod();

  async function handleCreate(): Promise<void> {
    try {
      const created = await createPeriod.mutateAsync({ year, month });
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
              onChange={(value) => setYear(value ?? now.getFullYear())}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="Month">
            <Select value={month} onChange={setMonth} options={MONTH_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
