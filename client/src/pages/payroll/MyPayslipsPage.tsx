import { useState } from 'react';
import { Button, Card, Table, Typography, message } from 'antd';
import { FilePdfOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { exportPayslipPdf, useMyPayslips, type MyPayslip } from '../../api/payroll';
import { formatIDR, formatPeriod, formatUSD } from '../../lib/format';
import { downloadErrorMessage } from '../../lib/download';
import PayslipBreakdown from './PayslipBreakdown';

export default function MyPayslipsPage() {
  const { data, isLoading } = useMyPayslips();
  const [exporting, setExporting] = useState<number | null>(null);

  async function handleDownload(payslip: MyPayslip): Promise<void> {
    setExporting(payslip.id);
    try {
      await exportPayslipPdf(payslip.id, payslip.year, payslip.month);
      message.success(`Payslip for ${formatPeriod(payslip.year, payslip.month)} downloaded`);
    } catch (err) {
      message.error(await downloadErrorMessage(err, 'Download failed'));
    } finally {
      setExporting(null);
    }
  }

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
      title: 'Payslip',
      align: 'center',
      render: (_v, record) => (
        <Button
          size="small"
          icon={<FilePdfOutlined />}
          onClick={() => handleDownload(record)}
          loading={exporting === record.id}
        >
          Download PDF
        </Button>
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
