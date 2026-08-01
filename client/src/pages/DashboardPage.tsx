import { Button, Card, Col, Empty, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import {
  useEmployeeDashboard,
  useHrDashboard,
  type OnLeaveTodayEntry,
  type UpcomingHoliday,
} from '../api/dashboard';
import { holidayTypeColor, holidayTypeLabel } from '../api/holidays';
import { leaveTypeColor } from '../api/leave';
import { payrollStatusColor } from '../api/payroll';
import { formatDate, formatIDR, formatPeriod } from '../lib/format';

function OnLeaveTodayCard({ items }: { items: OnLeaveTodayEntry[] }) {
  return (
    <Card title="On Leave Today">
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Everyone is in today" />
      ) : (
        <List
          dataSource={items}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={item.employeeName}
                description={<Tag color={leaveTypeColor[item.type]}>{item.type}</Tag>}
              />
              <Typography.Text type="secondary">until {formatDate(item.until)}</Typography.Text>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

function UpcomingHolidaysCard({ items }: { items: UpcomingHoliday[] }) {
  return (
    <Card title="Upcoming Holidays (30 days)">
      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No holidays in the next 30 days" />
      ) : (
        <List
          dataSource={items}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={item.name}
                description={<Tag color={holidayTypeColor[item.type]}>{holidayTypeLabel[item.type]}</Tag>}
              />
              <Typography.Text type="secondary">{formatDate(item.date)}</Typography.Text>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}

function HrDashboard() {
  const navigate = useNavigate();
  const { data, isLoading } = useHrDashboard(true);
  const headcount = data?.headcount;
  const pending = data?.pendingApprovals;
  const latestPeriod = data?.payroll.latestPeriod ?? null;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card loading={isLoading}>
            <Statistic title="Total Employees" value={headcount?.total ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={isLoading}>
            <Statistic title="Full-time" value={headcount?.fullTime ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={isLoading}>
            <Statistic title="Part-time" value={headcount?.partTime ?? 0} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card loading={isLoading}>
            <Statistic title="Leave Days This Month" value={data?.leaveThisMonth ?? 0} suffix="days" />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="Pending Approvals" loading={isLoading}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="Overtime" value={pending?.overtime ?? 0} />
              </Col>
              <Col span={12}>
                <Statistic title="Reimbursements" value={pending?.reimbursements ?? 0} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Latest Payroll Period" loading={isLoading}>
            {latestPeriod ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space size="middle" wrap>
                  <Typography.Text strong style={{ fontSize: 18 }}>
                    {formatPeriod(latestPeriod.year, latestPeriod.month)}
                  </Typography.Text>
                  <Tag color={payrollStatusColor[latestPeriod.status]}>{latestPeriod.status}</Tag>
                  <Typography.Text type="secondary">
                    {latestPeriod.payslipCount} payslip(s)
                  </Typography.Text>
                </Space>
                <Button type="primary" onClick={() => navigate('/payroll')}>
                  Go to Payroll
                </Button>
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payroll periods yet" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <OnLeaveTodayCard items={data?.onLeaveToday ?? []} />
        </Col>
        <Col xs={24} md={12}>
          <UpcomingHolidaysCard items={data?.upcomingHolidays ?? []} />
        </Col>
      </Row>
    </Space>
  );
}

function EmployeeDashboard({ isFullTime }: { isFullTime: boolean }) {
  const navigate = useNavigate();
  const { data, isLoading } = useEmployeeDashboard(true);
  const balance = data?.leaveBalance ?? null;
  const pending = data?.pending;
  const latestPayslip = data?.latestPayslip ?? null;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        {isFullTime ? (
          <>
            <Col xs={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Leave Balance" value={balance?.balance ?? 0} suffix="days" />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Used" value={balance?.usedTotal ?? 0} suffix="days" />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Sick Taken" value={balance?.sickTaken ?? 0} suffix="days" />
              </Card>
            </Col>
            {/* Ordered so the four leave stats fill one row and overtime wraps below. */}
            <Col xs={12} md={6}>
              <Card loading={isLoading}>
                <Statistic title="Unpaid Taken" value={balance?.unpaidTaken ?? 0} suffix="days" />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card loading={isLoading}>
                <Statistic
                  title="Overtime Hours This Month"
                  value={data?.thisMonth.approvedOvertimeHours ?? 0}
                  suffix="h"
                />
              </Card>
            </Col>
          </>
        ) : (
          <Col xs={24} md={8}>
            <Card loading={isLoading}>
              <Statistic
                title="Logged Hours This Month"
                value={data?.thisMonth.dailyLogHours ?? 0}
                suffix="h"
              />
            </Card>
          </Col>
        )}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Card title="My Pending Requests" loading={isLoading}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="Overtime" value={pending?.overtime ?? 0} />
              </Col>
              <Col span={12}>
                <Statistic title="Reimbursements" value={pending?.reimbursements ?? 0} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="Latest Payslip" loading={isLoading}>
            {latestPayslip ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Statistic
                  title={formatPeriod(latestPayslip.period.year, latestPayslip.period.month)}
                  value={formatIDR(latestPayslip.totalIdr)}
                />
                <Button type="primary" onClick={() => navigate('/my-payslips')}>
                  View Payslips
                </Button>
              </Space>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No payslips yet" />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <OnLeaveTodayCard items={data?.onLeaveToday ?? []} />
        </Col>
        <Col xs={24} md={12}>
          <UpcomingHolidaysCard items={data?.upcomingHolidays ?? []} />
        </Col>
      </Row>
    </Space>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const isHr = user?.roleName === 'HR';
  const isFullTime = user?.employee?.employmentType === 'FULL_TIME';
  const displayName = user?.employee?.nickname ?? user?.employee?.fullName ?? user?.email ?? '';

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          Welcome, {displayName}
        </Typography.Title>
        <Typography.Text type="secondary">
          Signed in as <Tag color={isHr ? 'geekblue' : 'green'}>{user?.roleName}</Tag>
        </Typography.Text>
      </div>
      {isHr ? <HrDashboard /> : <EmployeeDashboard isFullTime={isFullTime} />}
    </Space>
  );
}
