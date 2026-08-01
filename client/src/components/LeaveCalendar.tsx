import { useState } from 'react';
import {
  Badge,
  Button,
  Calendar,
  Card,
  DatePicker,
  Space,
  Spin,
  Tooltip,
  Typography,
  type CalendarProps,
} from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useLeaveCalendar, leaveTypeColor, leaveTypeLabel, type LeaveType } from '../api/leave';
import { holidayTypeColor, holidayTypeLabel, type HolidayType } from '../api/holidays';

const holidayTypes = Object.keys(holidayTypeLabel) as HolidayType[];
const leaveTypes = Object.keys(leaveTypeLabel) as LeaveType[];

// Shared leave/holiday calendar (design §6): per date cell shows holiday badges and
// leave badges (employee nickname). Month navigation refetches.
export default function LeaveCalendar() {
  const [panel, setPanel] = useState<Dayjs>(dayjs());
  const month = panel.format('YYYY-MM');
  const { data, isFetching } = useLeaveCalendar(month);

  const cellRender: CalendarProps<Dayjs>['cellRender'] = (current, info) => {
    if (info.type !== 'date') return info.originNode;
    const key = current.format('YYYY-MM-DD');

    const holidays = (data?.holidays ?? []).filter((holiday) => holiday.date.slice(0, 10) === key);
    const leaves = (data?.leaves ?? []).filter(
      (leave) => key >= leave.startDate.slice(0, 10) && key <= leave.endDate.slice(0, 10),
    );

    if (holidays.length === 0 && leaves.length === 0) return null;

    return (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {holidays.map((holiday) => (
          <li key={`h-${holiday.id}`}>
            <Tooltip title={`${holidayTypeLabel[holiday.type]} holiday`}>
              <Badge color={holidayTypeColor[holiday.type]} text={holiday.name} />
            </Tooltip>
          </li>
        ))}
        {leaves.map((leave) => (
          <li key={`l-${leave.id}`}>
            <Tooltip title={`${leave.employeeName} — ${leave.type} leave`}>
              <Badge
                color={leaveTypeColor[leave.type]}
                text={leave.employeeNickname ?? leave.employeeName}
              />
            </Tooltip>
          </li>
        ))}
      </ul>
    );
  };

  // The stock header navigates only through year/month dropdowns, so it is replaced by a
  // title plus a month picker for long jumps; stepping one month at a time lives in the
  // footer buttons below the grid. `onChange` is antd's own handler — calling it alongside
  // setPanel keeps Calendar's internal events firing for picker-driven changes.
  const headerRender: CalendarProps<Dayjs>['headerRender'] = ({ value, onChange }) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        paddingBottom: 12,
      }}
    >
      <Typography.Text strong style={{ fontSize: 16 }} aria-live="polite">
        {value.format('MMMM YYYY')}
      </Typography.Text>
      <DatePicker
        picker="month"
        aria-label="Jump to month"
        value={value}
        allowClear={false}
        onChange={(next) => {
          if (!next) return;
          onChange(next);
          setPanel(next);
        }}
        style={{ width: 140 }}
      />
    </div>
  );

  // Only the types actually present this month are worth a legend entry — a fixed
  // seven-item row is noise on a month with one holiday in it.
  const legend = [
    ...holidayTypes
      .filter((type) => data?.holidays.some((holiday) => holiday.type === type))
      .map((type) => ({ color: holidayTypeColor[type], label: holidayTypeLabel[type] })),
    ...leaveTypes
      .filter((type) => data?.leaves.some((leave) => leave.type === type))
      .map((type) => ({ color: leaveTypeColor[type], label: leaveTypeLabel[type] })),
  ];

  return (
    <Card>
      <Spin spinning={isFetching}>
        <Calendar
          value={panel}
          onSelect={(date, selectInfo) => {
            if (selectInfo.source === 'date') setPanel(date);
          }}
          onPanelChange={(date) => setPanel(date)}
          headerRender={headerRender}
          cellRender={cellRender}
        />
      </Spin>
      {/* Outside the Spin on purpose: a spinning Spin sets pointer-events:none on its
          children, which would make the month buttons dead while the month they just
          asked for is loading. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          marginTop: 16,
        }}
      >
        <Space size={[12, 4]} wrap>
          {legend.map((item) => (
            <Badge
              key={item.label}
              color={item.color}
              text={<Typography.Text type="secondary">{item.label}</Typography.Text>}
            />
          ))}
        </Space>
        <Space wrap style={{ marginLeft: 'auto' }}>
          <Button icon={<LeftOutlined />} onClick={() => setPanel(panel.subtract(1, 'month'))}>
            Previous
          </Button>
          <Button onClick={() => setPanel(dayjs())} disabled={panel.isSame(dayjs(), 'day')}>
            Today
          </Button>
          <Button
            icon={<RightOutlined />}
            iconPosition="end"
            onClick={() => setPanel(panel.add(1, 'month'))}
          >
            Next
          </Button>
        </Space>
      </div>
    </Card>
  );
}
