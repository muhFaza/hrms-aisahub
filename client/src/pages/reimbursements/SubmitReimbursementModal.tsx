import { useEffect } from 'react';
import { Button, DatePicker, Form, Input, InputNumber, Modal, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import type { Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import { useSubmitReimbursement } from '../../api/reimbursements';

interface ReimbursementValues {
  date: Dayjs;
  amount: number;
  description: string;
  evidence: UploadFile[];
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Mirrors server/src/middleware/upload.ts, which stays the real enforcement — these only
// spare the user a full multipart round-trip before the rejection.
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export default function SubmitReimbursementModal({ open, onClose }: Props) {
  const [form] = Form.useForm<ReimbursementValues>();
  const submitReimbursement = useSubmitReimbursement();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  async function onFinish(values: ReimbursementValues): Promise<void> {
    const file = values.evidence?.[0]?.originFileObj;
    if (!file) {
      message.error('Please attach an evidence file');
      return;
    }
    try {
      await submitReimbursement.mutateAsync({
        date: values.date.format('YYYY-MM-DD'),
        amount: values.amount,
        description: values.description,
        evidence: file,
      });
      message.success('Reimbursement submitted');
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to submit reimbursement');
    }
  }

  return (
    <Modal
      title="Submit Reimbursement"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={submitReimbursement.isPending}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item name="date" label="Date" rules={[{ required: true, message: 'Select a date' }]}>
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="amount"
          label="Amount (IDR)"
          rules={[{ required: true, message: 'Enter an amount' }]}
        >
          <InputNumber<number>
            style={{ width: '100%' }}
            min={1}
            step={1000}
            formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
            parser={(value) => (value ? Number(value.replace(/\./g, '')) : 0)}
          />
        </Form.Item>
        <Form.Item
          name="description"
          label="Description"
          rules={[{ required: true, message: 'Describe the expense' }]}
        >
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.Item
          name="evidence"
          label="Evidence (PDF/JPG/PNG, max 5MB)"
          valuePropName="fileList"
          getValueFromEvent={(event) => event?.fileList}
          rules={[{ required: true, message: 'Attach an evidence file' }]}
        >
          <Upload
            maxCount={1}
            accept=".pdf,.jpg,.jpeg,.png"
            beforeUpload={(file) => {
              if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                message.error('Only PDF, JPG, and PNG files are allowed');
                return Upload.LIST_IGNORE;
              }
              if (file.size > MAX_UPLOAD_BYTES) {
                message.error(
                  `File is too large — the maximum upload size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
                );
                return Upload.LIST_IGNORE;
              }
              // false keeps antd from auto-uploading; onFinish submits the file manually.
              return false;
            }}
            listType="text"
          >
            <Button icon={<UploadOutlined />}>Select File</Button>
          </Upload>
        </Form.Item>
      </Form>
    </Modal>
  );
}
