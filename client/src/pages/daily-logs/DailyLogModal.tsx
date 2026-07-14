import { useEffect } from 'react';
import { DatePicker, Form, Input, InputNumber, Modal, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import {
  useCreateDailyLog,
  useUpdateDailyLog,
  type DailyLog,
} from '../../api/dailyLogs';

interface DailyLogValues {
  date: Dayjs;
  hours: number;
  project: string;
  notes?: string;
}

interface Props {
  open: boolean;
  log: DailyLog | null;
  onClose: () => void;
}

export default function DailyLogModal({ open, log, onClose }: Props) {
  const [form] = Form.useForm<DailyLogValues>();
  const createLog = useCreateDailyLog();
  const updateLog = useUpdateDailyLog();
  const isEdit = log !== null;

  useEffect(() => {
    if (!open) return;
    if (log) {
      form.setFieldsValue({
        date: dayjs(log.date),
        hours: log.hours,
        project: log.project ?? '',
        notes: log.notes ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [open, log, form]);

  async function onFinish(values: DailyLogValues): Promise<void> {
    const payload = {
      date: values.date.format('YYYY-MM-DD'),
      hours: values.hours,
      project: values.project,
      notes: values.notes || null,
    };
    try {
      if (isEdit) {
        await updateLog.mutateAsync({ id: log.id, payload });
        message.success('Daily log updated');
      } else {
        await createLog.mutateAsync(payload);
        message.success('Daily log saved');
      }
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to save daily log');
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Daily Log' : 'Log Activity'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={createLog.isPending || updateLog.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Select a date' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="hours" label="Hours" rules={[{ required: true, message: 'Enter hours' }]}>
          <InputNumber style={{ width: '100%' }} min={0.5} max={24} step={0.5} />
        </Form.Item>
        <Form.Item
          name="project"
          label="Project"
          rules={[{ required: true, message: 'Enter a project' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
