import { Button, Card, Result, Skeleton, Space, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useEmployee } from '../../api/employees';
import EmployeeDescriptions from './EmployeeDescriptions';
import EmploymentHistoryCard from './EmploymentHistoryCard';

export default function EmployeeDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { data: employee, isLoading, isError } = useEmployee(id ? Number(id) : undefined);

  if (isLoading) {
    return (
      <Card>
        <Skeleton active />
      </Card>
    );
  }

  if (isError || !employee) {
    return <Result status="404" title="Employee not found" />;
  }

  return (
    <Card>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/employees')}>
            Back
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {employee.fullName}
          </Typography.Title>
        </div>
        <EmployeeDescriptions employee={employee} />
        <EmploymentHistoryCard employee={employee} />
      </Space>
    </Card>
  );
}
