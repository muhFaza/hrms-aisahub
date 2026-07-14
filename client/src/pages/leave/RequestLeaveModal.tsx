import { useEffect } from 'react';
import { DatePicker, Form, Input, Modal, Select, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import { useSubmitLeave, type LeaveType } from '../../api/leave';

const { RangePicker } = DatePicker;

interface RequestLeaveValues {
  type: LeaveType;
  range: [Dayjs, Dayjs];
  reason?: string;
}

interface Props {
  open: boolean;
  isFullTime: boolean;
  onClose: () => void;
}

export default function RequestLeaveModal({ open, isFullTime, onClose }: Props) {
  const [form] = Form.useForm<RequestLeaveValues>();
  const submitLeave = useSubmitLeave();

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    // Part-timers can only take sick leave (design §4).
    form.setFieldsValue({ type: isFullTime ? 'PAID' : 'SICK' });
  }, [open, isFullTime, form]);

  async function onFinish(values: RequestLeaveValues): Promise<void> {
    const [start, end] = values.range;
    try {
      await submitLeave.mutateAsync({
        type: values.type,
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        reason: values.reason || null,
      });
      message.success('Leave request submitted');
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to submit leave request');
    }
  }

  const typeOptions = isFullTime
    ? [
        { value: 'PAID', label: 'Paid Leave' },
        { value: 'SICK', label: 'Sick Leave' },
      ]
    : [{ value: 'SICK', label: 'Sick Leave' }];

  return (
    <Modal
      title="Request Leave"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={submitLeave.isPending}
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
  );
}
