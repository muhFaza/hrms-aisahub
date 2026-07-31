import { useState } from 'react';
import { Badge, Calendar, Card, Spin, Tooltip, type CalendarProps } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useLeaveCalendar, leaveTypeColor } from '../api/leave';
import { holidayTypeColor, holidayTypeLabel } from '../api/holidays';

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

  return (
    <Card>
      <Spin spinning={isFetching}>
        <Calendar
          value={panel}
          onSelect={(date, selectInfo) => {
            if (selectInfo.source === 'date') setPanel(date);
          }}
          onPanelChange={(date) => setPanel(date)}
          cellRender={cellRender}
        />
      </Spin>
    </Card>
  );
}
