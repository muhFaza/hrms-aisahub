import { useEffect } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import { useSubmitOvertime } from '../../api/overtime';

interface OvertimeValues {
  date: Dayjs;
  hours: number;
  description: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function SubmitOvertimeModal({ open, onClose }: Props) {
  const [form] = Form.useForm<OvertimeValues>();
  const submitOvertime = useSubmitOvertime();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  async function onFinish(values: OvertimeValues): Promise<void> {
    try {
      await submitOvertime.mutateAsync({
        date: values.date.format('YYYY-MM-DD'),
        hours: values.hours,
        description: values.description,
      });
      message.success('Overtime submitted');
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to submit overtime');
    }
  }

  return (
    <Modal
      title="Submit Overtime"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={submitOvertime.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Select a date' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="hours" label="Hours" rules={[{ required: true, message: 'Enter hours' }]}>
          <InputNumber style={{ width: '100%' }} min={0.5} max={12} step={0.5} />
        </Form.Item>
        <Form.Item
          name="description"
          label="Description"
          rules={[{ required: true, message: 'Describe the overtime work' }]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
