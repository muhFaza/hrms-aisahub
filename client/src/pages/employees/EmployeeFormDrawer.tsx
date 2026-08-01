import { useEffect, useState } from 'react';
import {
  Button,
  Checkbox,
  Col,
  DatePicker,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  Upload,
  message,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { AxiosError } from 'axios';
import {
  useCreateEmployee,
  useUpdateEmployee,
  useUploadContract,
  type Employee,
  type EmployeeFormPayload,
} from '../../api/employees';
import { useLeaveBalance } from '../../api/leave';
import type { EmploymentType } from '../../api/auth';

interface EmployeeFormValues {
  fullName: string;
  nickname?: string;
  joinDate: Dayjs;
  position: string;
  employmentType: EmploymentType;
  fullTimeSince?: Dayjs;
  contractStartDate?: Dayjs;
  contractEndDate?: Dayjs;
  monthlySalary?: number;
  hourlyRate?: number;
  email?: string;
  university?: string;
  major?: string;
  graduationYear?: number;
  linkedinUrl?: string;
  religion?: string;
  thrEligible?: boolean;
  bankName?: string;
  bankAccountNumber?: string;
  ktpNumber?: string;
  phoneNumber?: string;
  isActive?: boolean;
}

interface Props {
  open: boolean;
  employee: Employee | null;
  onClose: () => void;
}

function toPayload(values: EmployeeFormValues): EmployeeFormPayload {
  const isFullTime = values.employmentType === 'FULL_TIME';
  return {
    fullName: values.fullName,
    nickname: values.nickname || null,
    joinDate: values.joinDate.toISOString(),
    position: values.position,
    employmentType: values.employmentType,
    // Sent as a plain calendar day, NOT toISOString(): the picker yields local midnight, so an
    // ISO string from a UTC+7 client is the previous day in UTC. That shifts the accrual anchor
    // a whole month whenever the picked date is the 1st, granting a spurious paid-leave day.
    // A date-only string parses as UTC midnight, which is what the anchor must be.
    //
    // Omitted (undefined) rather than null when blank, so the server derives it from the
    // employmentType transition instead of clearing the anchor.
    fullTimeSince:
      isFullTime && values.fullTimeSince ? values.fullTimeSince.format('YYYY-MM-DD') : undefined,
    contractStartDate: values.contractStartDate ? values.contractStartDate.toISOString() : null,
    contractEndDate: values.contractEndDate ? values.contractEndDate.toISOString() : null,
    monthlySalary: isFullTime ? (values.monthlySalary ?? null) : null,
    hourlyRate: isFullTime ? null : (values.hourlyRate ?? null),
    email: values.email || null,
    university: values.university || null,
    major: values.major || null,
    graduationYear: values.graduationYear ?? null,
    linkedinUrl: values.linkedinUrl || null,
    religion: values.religion || null,
    thrEligible: Boolean(values.thrEligible),
    bankName: values.bankName || null,
    bankAccountNumber: values.bankAccountNumber || null,
    ktpNumber: values.ktpNumber || null,
    phoneNumber: values.phoneNumber || null,
    isActive: values.isActive ?? true,
  };
}

export default function EmployeeFormDrawer({ open, employee, onClose }: Props) {
  const [form] = Form.useForm<EmployeeFormValues>();
  const employmentType = Form.useWatch('employmentType', form);
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const uploadContract = useUploadContract();
  const isEdit = employee !== null;

  // Staged values for the employment-type change confirmation; nothing is sent until it is
  // acknowledged. Mirrors the two-step confirmation in RequestLeaveModal.
  const [pendingValues, setPendingValues] = useState<EmployeeFormValues | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const { data: balance } = useLeaveBalance(employee?.id);

  // Reset/populate the form whenever the drawer opens for a new target.
  useEffect(() => {
    if (!open) return;
    if (employee) {
      form.setFieldsValue({
        fullName: employee.fullName,
        nickname: employee.nickname ?? undefined,
        joinDate: dayjs(employee.joinDate),
        position: employee.position,
        employmentType: employee.employmentType,
        fullTimeSince: employee.fullTimeSince ? dayjs(employee.fullTimeSince) : undefined,
        contractStartDate: employee.contractStartDate ? dayjs(employee.contractStartDate) : undefined,
        contractEndDate: employee.contractEndDate ? dayjs(employee.contractEndDate) : undefined,
        monthlySalary: employee.monthlySalary ? Number(employee.monthlySalary) : undefined,
        hourlyRate: employee.hourlyRate ? Number(employee.hourlyRate) : undefined,
        email: employee.email ?? undefined,
        university: employee.university ?? undefined,
        major: employee.major ?? undefined,
        graduationYear: employee.graduationYear ?? undefined,
        linkedinUrl: employee.linkedinUrl ?? undefined,
        religion: employee.religion ?? undefined,
        thrEligible: employee.thrEligible,
        bankName: employee.bankName ?? undefined,
        bankAccountNumber: employee.bankAccountNumber ?? undefined,
        ktpNumber: employee.ktpNumber ?? undefined,
        phoneNumber: employee.phoneNumber ?? undefined,
        isActive: employee.isActive,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ employmentType: 'FULL_TIME', thrEligible: false, isActive: true });
    }
  }, [open, employee, form]);

  // Changing employmentType is consequential in both directions — it starts or stops paid
  // leave accrual and gates the whole leave feature — so it goes through a confirmation step
  // rather than saving straight from the form.
  async function onFinish(values: EmployeeFormValues): Promise<void> {
    if (employee && values.employmentType !== employee.employmentType) {
      setAcknowledged(false);
      setPendingValues(values);
      return;
    }
    await save(values);
  }

  async function save(values: EmployeeFormValues): Promise<void> {
    const payload = toPayload(values);
    try {
      if (employee) {
        await updateEmployee.mutateAsync({ id: employee.id, payload });
        message.success('Employee updated');
      } else {
        await createEmployee.mutateAsync(payload);
        message.success('Employee created');
      }
      setPendingValues(null);
      onClose();
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      message.error(axiosError.response?.data?.error ?? 'Failed to save employee');
    }
  }

  async function handleUpload(file: File): Promise<void> {
    if (!employee) return;
    try {
      await uploadContract.mutateAsync({ id: employee.id, file });
      message.success('Contract uploaded');
    } catch {
      message.error('Failed to upload contract');
    }
  }

  const saving = createEmployee.isPending || updateEmployee.isPending;
  const toPartTime = pendingValues?.employmentType === 'PART_TIME';
  const strandedDays = balance?.balance ?? 0;

  return (
    <>
    <Drawer
      title={isEdit ? 'Edit Employee' : 'New Employee'}
      width={640}
      open={open}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            Save
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Divider orientation="left">Personal</Divider>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="nickname" label="Nickname">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="phoneNumber" label="Phone Number">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="religion" label="Religion">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="ktpNumber"
              label="KTP Number"
              rules={[{ pattern: /^\d{16}$/, message: 'KTP must be exactly 16 digits' }]}
            >
              <Input maxLength={16} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Employment</Divider>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="position" label="Position" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="employmentType" label="Employment Type" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'FULL_TIME', label: 'Full-time' },
                  { value: 'PART_TIME', label: 'Part-time' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="joinDate" label="Join Date" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="isActive" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          {employmentType === 'FULL_TIME' && (
            <Col span={12}>
              <Form.Item
                name="fullTimeSince"
                label="Full-time Since"
                tooltip="Paid leave accrues from this date, not the join date. Leave blank and it is set automatically when the employee becomes full-time — set it only to correct a conversion recorded late."
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Divider orientation="left">Contract</Divider>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="contractStartDate" label="Contract Start">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="contractEndDate" label="Contract End">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={24}>
            <Form.Item label="Contract File">
              {isEdit ? (
                <Upload
                  showUploadList={false}
                  accept=".pdf,.jpg,.jpeg,.png"
                  beforeUpload={(file) => {
                    void handleUpload(file);
                    return false;
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={uploadContract.isPending}>
                    {employee?.contractFilePath ? 'Replace Contract' : 'Upload Contract'}
                  </Button>
                </Upload>
              ) : (
                <span style={{ color: '#999' }}>Save the employee first, then upload a contract.</span>
              )}
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Payment</Divider>
        <Row gutter={16}>
          {employmentType === 'FULL_TIME' ? (
            <Col span={12}>
              <Form.Item
                name="monthlySalary"
                label="Monthly Salary (IDR)"
                rules={[{ required: true, message: 'Required for full-time' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} step={100000} />
              </Form.Item>
            </Col>
          ) : (
            <Col span={12}>
              <Form.Item
                name="hourlyRate"
                label="Hourly Rate (IDR)"
                rules={[{ required: true, message: 'Required for part-time' }]}
              >
                <InputNumber style={{ width: '100%' }} min={0} step={5000} />
              </Form.Item>
            </Col>
          )}
          <Col span={12}>
            <Form.Item name="thrEligible" label="THR Eligible" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="bankName" label="Bank Name">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="bankAccountNumber" label="Bank Account Number">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Education & Social</Divider>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="university" label="University">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="major" label="Major">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="graduationYear" label="Graduation Year">
              <InputNumber style={{ width: '100%' }} min={1950} max={2100} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="linkedinUrl" label="LinkedIn URL" rules={[{ type: 'url' }]}>
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Drawer>

    {/* Sits above the drawer so Back leaves the entered values intact. */}
    <Modal
      title="Change employment type?"
      open={pendingValues !== null}
      onCancel={() => {
        if (!saving) setPendingValues(null);
      }}
      onOk={() => {
        if (pendingValues) void save(pendingValues);
      }}
      confirmLoading={saving}
      okText={toPartTime ? 'Convert to Part-time' : 'Convert to Full-time'}
      okButtonProps={{ disabled: toPartTime && !acknowledged }}
      cancelText="Back"
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={false}
      keyboard={!saving}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text strong>
          {employee?.nickname ?? employee?.fullName} · {toPartTime ? 'Full-time' : 'Part-time'} →{' '}
          {toPartTime ? 'Part-time' : 'Full-time'}
        </Typography.Text>

        {toPartTime ? (
          <>
            <Typography.Text>
              This employee has <strong>{strandedDays} day(s)</strong> of accrued paid leave.
              Converting them to part-time stops accrual, and those days become unusable — a
              leave balance cannot be paid out or transferred.
            </Typography.Text>
            <Typography.Text>
              They will no longer be able to submit any leave. Existing leave history is kept
              and stays visible to HR.
            </Typography.Text>
            <Checkbox
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            >
              I understand the accrued balance will be lost.
            </Checkbox>
          </>
        ) : (
          <Typography.Text>
            Paid leave accrual starts from today, not from their join date. They will be able
            to submit leave.
          </Typography.Text>
        )}
      </Space>
    </Modal>
    </>
  );
}
