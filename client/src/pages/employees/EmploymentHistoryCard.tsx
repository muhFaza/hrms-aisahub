import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { AxiosError } from 'axios';
import {
  useRehireEmployee,
  useTerminateEmployee,
  type Employee,
  type Employment,
  type EmploymentEndReason,
} from '../../api/employees';
import { formatDate } from '../../lib/format';

const END_REASONS: { value: EmploymentEndReason; label: string }[] = [
  { value: 'CONTRACT_END', label: 'Contract ended' },
  { value: 'RESIGNATION', label: 'Resignation' },
  { value: 'DISMISSAL', label: 'Dismissal' },
  { value: 'OTHER', label: 'Other' },
];

const REASON_LABELS: Record<EmploymentEndReason, string> = {
  CONTRACT_END: 'Contract ended',
  RESIGNATION: 'Resignation',
  DISMISSAL: 'Dismissal',
  OTHER: 'Other',
};

interface TerminateValues {
  endDate: Dayjs;
  endReason: EmploymentEndReason;
  endNote?: string;
}

interface RehireValues {
  startDate: Dayjs;
  contractStartDate?: Dayjs;
  contractEndDate?: Dayjs;
}

function errorMessage(err: unknown, fallback: string): string {
  return (err as AxiosError<{ error?: string }>).response?.data?.error ?? fallback;
}

export default function EmploymentHistoryCard({ employee }: { employee: Employee }) {
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [rehireOpen, setRehireOpen] = useState(false);
  const [terminateForm] = Form.useForm<TerminateValues>();
  const [rehireForm] = Form.useForm<RehireValues>();
  const terminate = useTerminateEmployee();
  const rehire = useRehireEmployee();

  const isActive = employee.status === 'ACTIVE';
  const current = employee.employments[0] ?? null;
  // Active AND already carrying an end date = serving out a notice period.
  const onNotice = isActive && current?.endDate != null;

  function openTerminate(): void {
    terminateForm.resetFields();
    // Defaults to the contract end date when there is one — the common case is a contract
    // running its course — but it stays editable, because people leave early and stay late.
    terminateForm.setFieldsValue({
      endDate: current?.contractEndDate ? dayjs(current.contractEndDate) : dayjs(),
      endReason: current?.contractEndDate ? 'CONTRACT_END' : 'RESIGNATION',
    });
    setTerminateOpen(true);
  }

  async function submitTerminate(values: TerminateValues): Promise<void> {
    try {
      await terminate.mutateAsync({
        id: employee.id,
        payload: {
          endDate: values.endDate.format('YYYY-MM-DD'),
          endReason: values.endReason,
          endNote: values.endNote || null,
        },
      });
      setTerminateOpen(false);
      message.success('Employment ended');
    } catch (err) {
      message.error(errorMessage(err, 'Failed to record the termination'));
    }
  }

  async function submitRehire(values: RehireValues): Promise<void> {
    try {
      await rehire.mutateAsync({
        id: employee.id,
        payload: {
          startDate: values.startDate.format('YYYY-MM-DD'),
          contractStartDate: values.contractStartDate?.format('YYYY-MM-DD') ?? null,
          contractEndDate: values.contractEndDate?.format('YYYY-MM-DD') ?? null,
        },
      });
      setRehireOpen(false);
      message.success('Employment reopened');
    } catch (err) {
      message.error(errorMessage(err, 'Failed to record the rehire'));
    }
  }

  const columns: ColumnsType<Employment> = [
    {
      title: 'Period',
      render: (_value, row) =>
        `${formatDate(row.startDate)} — ${row.endDate ? formatDate(row.endDate) : 'present'}`,
    },
    {
      title: 'Status',
      // Three states, not two: an end date that has not yet arrived is a notice period, and
      // labelling it "Ended" contradicted the Active badge on the same page.
      render: (_value, row) => {
        if (!row.endDate) return <Tag color="green">Current</Tag>;
        return dayjs(row.endDate).isBefore(dayjs(), 'day') ? (
          <Tag color="red">Ended</Tag>
        ) : (
          <Tag color="orange">Notice</Tag>
        );
      },
    },
    {
      title: 'Contract',
      render: (_value, row) =>
        row.contractStartDate || row.contractEndDate
          ? `${formatDate(row.contractStartDate)} — ${formatDate(row.contractEndDate)}`
          : '—',
    },
    {
      title: 'Reason',
      render: (_value, row) => (row.endReason ? REASON_LABELS[row.endReason] : '—'),
    },
    {
      title: 'Leave at exit',
      render: (_value, row) =>
        row.leaveBalanceAtEnd === null ? '—' : `${row.leaveBalanceAtEnd} day(s)`,
    },
    {
      title: 'Note',
      render: (_value, row) => row.endNote ?? '—',
    },
  ];

  return (
    <Card
      title="Employment History"
      extra={
        isActive ? (
          // Already serving notice: the employment is closed, so terminating again returns
          // 409. Say so rather than offering a button that only produces an error.
          onNotice ? (
            <Tooltip title="This employment already has an end date recorded.">
              <Button danger disabled>
                Notice served
              </Button>
            </Tooltip>
          ) : (
            <Button danger onClick={openTerminate}>
              End Employment
            </Button>
          )
        ) : (
          <Button
            type="primary"
            onClick={() => {
              rehireForm.resetFields();
              rehireForm.setFieldsValue({ startDate: dayjs() });
              setRehireOpen(true);
            }}
          >
            Rehire
          </Button>
        )
      }
    >
      <Table<Employment>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={employee.employments}
        columns={columns}
      />

      <Modal
        title="End Employment"
        open={terminateOpen}
        onCancel={() => setTerminateOpen(false)}
        onOk={() => terminateForm.submit()}
        confirmLoading={terminate.isPending}
        okText="End Employment"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="What ending an employment does"
          description={
            <Space direction="vertical" size={2}>
              <Typography.Text>
                The final month's salary is prorated to the working days actually worked.
              </Typography.Text>
              <Typography.Text>
                Sign-in stops the day after the end date, and no new leave, overtime,
                reimbursements or daily logs can be filed.
              </Typography.Text>
              <Typography.Text>
                The remaining leave balance is recorded against this employment and forfeited.
                It is not paid out.
              </Typography.Text>
              <Typography.Text type="secondary">
                A future date serves notice: access continues until it passes.
              </Typography.Text>
            </Space>
          }
        />
        <Form form={terminateForm} layout="vertical" onFinish={submitTerminate}>
          <Form.Item
            name="endDate"
            label="Last Day of Employment"
            extra="Inclusive — this day is worked and paid."
            rules={[{ required: true, message: 'Please choose the last day' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="endReason"
            label="Reason"
            rules={[{ required: true, message: 'Please choose a reason' }]}
          >
            <Select options={END_REASONS} />
          </Form.Item>
          <Form.Item name="endNote" label="Note (optional)">
            <Input.TextArea rows={2} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Rehire"
        open={rehireOpen}
        onCancel={() => setRehireOpen(false)}
        onOk={() => rehireForm.submit()}
        confirmLoading={rehire.isPending}
        okText="Rehire"
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="This starts a new employment"
          description="The previous engagement stays on record untouched. Leave starts from zero — days earned under the old contract are not carried over — and the new contract dates apply only to this engagement."
        />
        <Form form={rehireForm} layout="vertical" onFinish={submitRehire}>
          <Form.Item
            name="startDate"
            label="Start Date"
            extra="Must be after the previous employment ended."
            rules={[{ required: true, message: 'Please choose a start date' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="contractStartDate" label="Contract Start">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="contractEndDate" label="Contract End">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
