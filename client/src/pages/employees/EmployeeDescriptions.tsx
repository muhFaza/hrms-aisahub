import { Button, Descriptions, Space, Tag, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { downloadContract, type Employee } from '../../api/employees';
import { formatDate, formatIDR } from '../../lib/format';

// Read-only grouped view of an employee, reused by the HR detail page and the employee profile.
export default function EmployeeDescriptions({ employee }: { employee: Employee }) {
  async function onDownload(): Promise<void> {
    try {
      await downloadContract(employee.id, `contract-${employee.fullName}.pdf`);
    } catch {
      message.error('Unable to download the contract file.');
    }
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Descriptions title="Personal" bordered column={2} size="small">
        <Descriptions.Item label="Full Name">{employee.fullName}</Descriptions.Item>
        <Descriptions.Item label="Nickname">{employee.nickname ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Email">{employee.email ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Phone">{employee.phoneNumber ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Religion">{employee.religion ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="KTP Number">{employee.ktpNumber ?? '-'}</Descriptions.Item>
      </Descriptions>

      <Descriptions title="Employment" bordered column={2} size="small">
        <Descriptions.Item label="Position">{employee.position}</Descriptions.Item>
        <Descriptions.Item label="Type">
          <Tag color={employee.employmentType === 'FULL_TIME' ? 'blue' : 'gold'}>
            {employee.employmentType === 'FULL_TIME' ? 'Full-time' : 'Part-time'}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="Join Date">{formatDate(employee.joinDate)}</Descriptions.Item>
        <Descriptions.Item label="Status">
          <Tag color={employee.isActive ? 'green' : 'red'}>
            {employee.isActive ? 'Active' : 'Inactive'}
          </Tag>
        </Descriptions.Item>
      </Descriptions>

      <Descriptions title="Contract" bordered column={2} size="small">
        <Descriptions.Item label="Start Date">
          {formatDate(employee.contractStartDate)}
        </Descriptions.Item>
        <Descriptions.Item label="End Date">
          {formatDate(employee.contractEndDate)}
        </Descriptions.Item>
        <Descriptions.Item label="Contract File" span={2}>
          {employee.contractFilePath ? (
            <Button icon={<DownloadOutlined />} onClick={onDownload}>
              Download Contract
            </Button>
          ) : (
            <Typography.Text type="secondary">No file uploaded</Typography.Text>
          )}
        </Descriptions.Item>
      </Descriptions>

      <Descriptions title="Payment" bordered column={2} size="small">
        <Descriptions.Item label="Monthly Salary">{formatIDR(employee.monthlySalary)}</Descriptions.Item>
        <Descriptions.Item label="Hourly Rate">{formatIDR(employee.hourlyRate)}</Descriptions.Item>
        <Descriptions.Item label="THR Eligible">
          {employee.thrEligible ? 'Yes' : 'No'}
        </Descriptions.Item>
        <Descriptions.Item label="Bank">{employee.bankName ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Bank Account" span={2}>
          {employee.bankAccountNumber ?? '-'}
        </Descriptions.Item>
      </Descriptions>

      <Descriptions title="Education & Social" bordered column={2} size="small">
        <Descriptions.Item label="University">{employee.university ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Major">{employee.major ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="Graduation Year">{employee.graduationYear ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="LinkedIn">
          {employee.linkedinUrl ? (
            <a href={employee.linkedinUrl} target="_blank" rel="noreferrer">
              {employee.linkedinUrl}
            </a>
          ) : (
            '-'
          )}
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}
