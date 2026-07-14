import { Card, Table, Tag, Typography } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useMyPayslips, type MyPayslip } from '../../api/payroll';
import { formatIDR, formatPeriod, formatUSD } from '../../lib/format';
import PayslipBreakdown from './PayslipBreakdown';

export default function MyPayslipsPage() {
  const { data, isLoading } = useMyPayslips();

  const columns: ColumnsType<MyPayslip> = [
    { title: 'Period', render: (_v, record) => formatPeriod(record.year, record.month) },
    {
      title: 'Total IDR',
      dataIndex: 'totalIdr',
      align: 'right',
      render: (v: number) => <strong>{formatIDR(v)}</strong>,
    },
    { title: 'Total USD', dataIndex: 'totalUsd', align: 'right', render: (v: number) => formatUSD(v) },
    {
      title: 'Email',
      dataIndex: 'emailSentAt',
      width: 140,
      render: (value: string | null) =>
        value ? (
          <Tag icon={<CheckCircleOutlined />} color="green">
            Sent
          </Tag>
        ) : (
          <Tag icon={<ClockCircleOutlined />} color="default">
            Not sent
          </Tag>
        ),
    },
  ];

  return (
    <Card
      title={
        <Typography.Title level={5} style={{ margin: 0 }}>
          My Payslips
        </Typography.Title>
      }
    >
      <Table<MyPayslip>
        rowKey="id"
        loading={isLoading}
        columns={columns}
        dataSource={data ?? []}
        pagination={false}
        expandable={{
          expandedRowRender: (record) => (
            <PayslipBreakdown
              employmentType={record.detail.employmentType}
              basicSalary={record.basicSalary}
              overtimePay={record.overtimePay}
              reimbursementTotal={record.reimbursementTotal}
              leaveDeduction={record.leaveDeduction}
              totalIdr={record.totalIdr}
              totalUsd={record.totalUsd}
              detail={record.detail}
            />
          ),
        }}
      />
    </Card>
  );
}
