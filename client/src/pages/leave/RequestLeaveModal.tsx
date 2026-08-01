import { useEffect, useState } from 'react';
import { Checkbox, DatePicker, Form, Input, Modal, Select, Space, Typography, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import { useSubmitLeave, leaveTypeLabel, type LeaveType } from '../../api/leave';
import { formatDate } from '../../lib/format';

const { RangePicker } = DatePicker;

interface RequestLeaveValues {
  type: LeaveType;
  range: [Dayjs, Dayjs];
  reason?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Weekdays in the range. The server's countWorkingDays also drops national/company holidays
// (but not joint leave, which is worked) and stays authoritative — this is display only, so the
// confirmation can show a figure.
function estimateWorkingDays(start: Dayjs, end: Dayjs): number {
  let days = 0;
  for (let cursor = start; !cursor.isAfter(end, 'day'); cursor = cursor.add(1, 'day')) {
    if (cursor.day() !== 0 && cursor.day() !== 6) days += 1;
  }
  return days;
}

export default function RequestLeaveModal({ open, onClose }: Props) {
  const [form] = Form.useForm<RequestLeaveValues>();
  const [pending, setPending] = useState<RequestLeaveValues | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const submitLeave = useSubmitLeave();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setPending(null);
    setAcknowledged(false);
    form.setFieldsValue({ type: 'PAID' });
  }, [open, form]);

  // Step 1 only stages the values; nothing is sent until the confirmation is acknowledged.
  function onFinish(values: RequestLeaveValues): void {
    setAcknowledged(false);
    setPending(values);
  }

  function handleClose(): void {
    setPending(null);
    onClose();
  }

  // Dismissing mid-flight would let the user reopen and resubmit while the first POST is
  // still holding the employee's row lock, so every exit from step 2 is blocked until it lands.
  function handleBack(): void {
    if (submitLeave.isPending) return;
    setPending(null);
  }

  async function handleConfirm(): Promise<void> {
    if (!pending || submitLeave.isPending) return;
    const [start, end] = pending.range;
    try {
      await submitLeave.mutateAsync({
        type: pending.type,
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        reason: pending.reason || null,
      });
      message.success('Leave recorded');
      handleClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to submit leave request');
    }
  }

  // Leave is a full-time-only feature, so every type is available to everyone who can reach
  // this modal. Sick and unpaid both deduct salary; only paid draws on the accrued balance.
  const typeOptions = [
    { value: 'PAID', label: leaveTypeLabel.PAID },
    { value: 'SICK', label: leaveTypeLabel.SICK },
    { value: 'UNPAID', label: leaveTypeLabel.UNPAID },
  ];

  return (
    <>
      <Modal
        title="Request Leave"
        open={open}
        onCancel={handleClose}
        onOk={() => form.submit()}
        okText="Continue"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="type" label="Type" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="range" label="Dates" rules={[{ required: true, message: 'Select a date range' }]}>
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Step 2. Sits on top of the form modal so Back leaves the entered values intact. */}
      <Modal
        title="Before you submit"
        open={pending !== null}
        onCancel={handleBack}
        onOk={handleConfirm}
        confirmLoading={submitLeave.isPending}
        okText="Submit Leave"
        okButtonProps={{ disabled: !acknowledged }}
        cancelText="Back"
        cancelButtonProps={{ disabled: submitLeave.isPending }}
        closable={!submitLeave.isPending}
        maskClosable={false}
        keyboard={!submitLeave.isPending}
      >
        {pending && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Typography.Text strong>
                {leaveTypeLabel[pending.type]} · {formatDate(pending.range[0].format('YYYY-MM-DD'))} —{' '}
                {formatDate(pending.range[1].format('YYYY-MM-DD'))} ·{' '}
                {estimateWorkingDays(pending.range[0], pending.range[1])} working day(s)
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">
                Estimate — weekends excluded. National and company holidays are also excluded
                from the recorded total; joint leave (cuti bersama) is a working day and counts.
              </Typography.Text>
            </div>

            <Typography.Text>
              Leave is recorded immediately — there is no HR approval step.
            </Typography.Text>

            {pending.type !== 'PAID' && (
              <Typography.Text type="warning">
                {leaveTypeLabel[pending.type]} is deducted from your salary at your daily rate
                for each working day taken. It does not use your accrued paid leave balance.
              </Typography.Text>
            )}

            <Checkbox
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            >
              I have notified my team and obtained approval from my project manager.
            </Checkbox>
          </Space>
        )}
      </Modal>
    </>
  );
}
