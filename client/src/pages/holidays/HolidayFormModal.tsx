import { useEffect } from 'react';
import { DatePicker, Form, Input, Modal, Select, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import {
  useCreateHoliday,
  useUpdateHoliday,
  type Holiday,
  type HolidayType,
} from '../../api/holidays';

interface HolidayFormValues {
  name: string;
  date: Dayjs;
  type: HolidayType;
  notes?: string;
}

interface Props {
  open: boolean;
  holiday: Holiday | null;
  onClose: () => void;
}

const typeOptions = [
  { value: 'NATIONAL', label: 'National' },
  { value: 'COMPANY', label: 'Company' },
  { value: 'JOINT_LEAVE', label: 'Joint Leave' },
  { value: 'SPECIAL', label: 'Special' },
];

export default function HolidayFormModal({ open, holiday, onClose }: Props) {
  const [form] = Form.useForm<HolidayFormValues>();
  const createHoliday = useCreateHoliday();
  const updateHoliday = useUpdateHoliday();
  const isEdit = holiday !== null;

  useEffect(() => {
    if (!open) return;
    if (holiday) {
      form.setFieldsValue({
        name: holiday.name,
        date: dayjs(holiday.date),
        type: holiday.type,
        notes: holiday.notes ?? undefined,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ type: 'NATIONAL' });
    }
  }, [open, holiday, form]);

  async function onFinish(values: HolidayFormValues): Promise<void> {
    // Date-only string keeps the server's @db.Date free of timezone drift.
    const payload = {
      name: values.name,
      date: values.date.format('YYYY-MM-DD'),
      type: values.type,
      notes: values.notes || null,
    };
    try {
      if (holiday) {
        await updateHoliday.mutateAsync({ id: holiday.id, payload });
        message.success('Holiday updated');
      } else {
        await createHoliday.mutateAsync(payload);
        message.success('Holiday created');
      }
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to save holiday');
    }
  }

  return (
    <Modal
      title={isEdit ? 'Edit Holiday' : 'New Holiday'}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={createHoliday.isPending || updateHoliday.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="date" label="Date" rules={[{ required: true }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="type" label="Type" rules={[{ required: true }]}>
          <Select options={typeOptions} />
        </Form.Item>
        <Form.Item name="notes" label="Notes">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
