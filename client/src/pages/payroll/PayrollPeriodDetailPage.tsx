import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  InputNumber,
  Modal,
  Popconfirm,
  Result,
  Skeleton,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ArrowLeftOutlined, LockOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { AxiosError } from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useDeletePeriod,
  useFinalizePeriod,
  usePayrollPreview,
  useUpdateRate,
  payrollStatusColor,
  rateSourceColor,
  type PayslipRow,
} from '../../api/payroll';
import { formatIDR, formatPeriod, formatUSD } from '../../lib/format';
import PayslipBreakdown from './PayslipBreakdown';

function errorMessage(err: unknown, fallback: string): string {
  const axiosError = err as AxiosError<{ error?: string }>;
  return axiosError.response?.data?.error ?? fallback;
}

export default function PayrollPeriodDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const periodId = id ? Number(id) : undefined;
  const { data, isLoading, isError } = usePayrollPreview(periodId);
  const updateRate = useUpdateRate();
  const finalizePeriod = useFinalizePeriod();
  const deletePeriod = useDeletePeriod();

  const [rate, setRate] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (data) setRate(data.period.exchangeRate);
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <Skeleton active />
      </Card>
    );
  }
  if (isError || !data || periodId === undefined) {
    return <Result status="404" title="Payroll period not found" />;
  }

  const { period, rows, totals } = data;
  const isDraft = period.status === 'DRAFT';

  async function handleSaveRate(): Promise<void> {
    if (periodId === undefined || rate === null) return;
    try {
      await updateRate.mutateAsync({ id: periodId, exchangeRate: rate });
      message.success('Exchange rate updated');
    } catch (err) {
      message.error(errorMessage(err, 'Failed to update rate'));
    }
  }

  async function handleFinalize(): Promise<void> {
    if (periodId === undefined) return;
    try {
      await finalizePeriod.mutateAsync(periodId);
      setConfirmOpen(false);
      message.success('Period finalized — payslips created and emails dispatched');
    } catch (err) {
      message.error(errorMessage(err, 'Failed to finalize'));
    }
  }

  async function handleDelete(): Promise<void> {
    if (periodId === undefined) return;
    try {
      await deletePeriod.mutateAsync(periodId);
      message.success('Draft period deleted');
      navigate('/payroll');
    } catch (err) {
      message.error(errorMessage(err, 'Failed to delete'));
    }
  }

  const columns: ColumnsType<PayslipRow> = [
    { title: 'Employee', dataIndex: 'name' },
    {
      title: 'Type',
      dataIndex: 'employmentType',
      render: (value: PayslipRow['employmentType']) => (
        <Tag color={value === 'FULL_TIME' ? 'geekblue' : 'purple'}>{value}</Tag>
      ),
    },
    { title: 'Basic', dataIndex: 'basicSalary', align: 'right', render: (v: number) => formatIDR(v) },
    { title: 'Overtime', dataIndex: 'overtimePay', align: 'right', render: (v: number) => formatIDR(v) },
    {
      title: 'Reimbursement',
      dataIndex: 'reimbursementTotal',
      align: 'right',
      render: (v: number) => formatIDR(v),
    },
    {
      title: 'Deduction',
      dataIndex: 'leaveDeduction',
      align: 'right',
      render: (v: number) => (v > 0 ? <span style={{ color: '#ff4d4f' }}>-{formatIDR(v)}</span> : formatIDR(0)),
    },
    {
      title: 'Total IDR',
      dataIndex: 'totalIdr',
      align: 'right',
      render: (v: number) => <strong>{formatIDR(v)}</strong>,
    },
    { title: 'Total USD', dataIndex: 'totalUsd', align: 'right', render: (v: number) => formatUSD(v) },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/payroll')}>
            Back
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {formatPeriod(period.year, period.month)}
          </Typography.Title>
          <Tag color={payrollStatusColor[period.status]}>{period.status}</Tag>
          <Tag color={rateSourceColor[period.rateSource]}>{period.rateSource}</Tag>
          <div style={{ flex: 1 }} />
          {isDraft ? (
            <Space>
              <span>Rate (IDR/USD):</span>
              <InputNumber
                min={1}
                value={rate}
                onChange={setRate}
                style={{ width: 140 }}
                formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                parser={(v) => Number((v ?? '').replace(/,/g, ''))}
              />
              <Button
                onClick={handleSaveRate}
                loading={updateRate.isPending}
                disabled={rate === null || rate === period.exchangeRate}
              >
                Save rate
              </Button>
              <Popconfirm title="Delete this draft period?" onConfirm={handleDelete}>
                <Button danger loading={deletePeriod.isPending}>
                  Delete
                </Button>
              </Popconfirm>
              <Button type="primary" onClick={() => setConfirmOpen(true)}>
                Finalize
              </Button>
            </Space>
          ) : (
            <Typography.Text type="secondary">
              <LockOutlined /> Finalized — records for this month are locked. Rate {formatIDR(period.exchangeRate)}/USD.
            </Typography.Text>
          )}
        </div>
      </Card>

      <Card>
        <Table<PayslipRow>
          rowKey="employeeId"
          columns={columns}
          dataSource={rows}
          pagination={false}
          expandable={{
            expandedRowRender: (record) => <PayslipBreakdown {...record} />,
          }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={6}>
                <strong>Totals ({totals.count} employees)</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={6} align="right">
                <strong>{formatIDR(totals.totalIdr)}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={7} align="right">
                <strong>{formatUSD(totals.totalUsd)}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Card>

      <Modal
        title="Finalize payroll period"
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onOk={handleFinalize}
        confirmLoading={finalizePeriod.isPending}
        okText="Finalize"
        okButtonProps={{ danger: true }}
      >
        <p>
          Finalizing <strong>{formatPeriod(period.year, period.month)}</strong> will:
        </p>
        <ul>
          <li>Snapshot {totals.count} payslip(s) with the current exchange rate.</li>
          <li>Lock all source records dated in this month from further edits.</li>
          <li>Email each employee their payslip.</li>
        </ul>
        <p>This action cannot be undone.</p>
      </Modal>
    </Space>
  );
}
