import { Descriptions, Tag } from 'antd';
import type { EmploymentType, PayslipDetail } from '../../api/payroll';
import { formatIDR, formatUSD } from '../../lib/format';

interface Props {
  employmentType: EmploymentType;
  basicSalary: number;
  overtimePay: number;
  reimbursementTotal: number;
  leaveDeduction: number;
  totalIdr: number;
  totalUsd: number;
  detail: PayslipDetail;
}

// Explains a payslip's numbers from the stored/computed detail breakdown (design §4).
export default function PayslipBreakdown(props: Props): React.ReactElement {
  const { detail } = props;
  const isFullTime = props.employmentType === 'FULL_TIME';

  // Payslips finalized before unpaid leave existed have no unpaidDays in their stored detail.
  const sickDays = detail.sickDays ?? 0;
  const unpaidDays = detail.unpaidDays ?? 0;
  const unpaidLeaveIds = detail.unpaidLeaveIds ?? [];

  // Per-type money is derived, never stored: leaveDeduction is rounded once over the combined
  // days so the two lines can't disagree with it. Deriving sick and handing unpaid the
  // remainder keeps them summing to the stored total exactly, whatever the rounding did.
  const sickDeduction =
    unpaidDays === 0 ? props.leaveDeduction : Math.round(sickDays * (detail.dailyRate ?? 0));
  const unpaidDeduction = props.leaveDeduction - sickDeduction;

  return (
    <Descriptions size="small" column={2} bordered>
      <Descriptions.Item label="Employment type">
        <Tag color={isFullTime ? 'geekblue' : 'purple'}>{props.employmentType}</Tag>
      </Descriptions.Item>
      <Descriptions.Item label="Exchange rate">
        {formatIDR(detail.exchangeRate)} / USD 1.00
      </Descriptions.Item>

      {isFullTime ? (
        <>
          <Descriptions.Item label="Monthly salary">
            {formatIDR(detail.monthlySalary)}
          </Descriptions.Item>
          <Descriptions.Item label="Derived hourly / daily">
            {formatIDR(detail.derivedHourly)} / {formatIDR(detail.dailyRate)}
          </Descriptions.Item>
          <Descriptions.Item label="Overtime">
            {detail.overtimeHours} h ({detail.overtimeIds.length} entr
            {detail.overtimeIds.length === 1 ? 'y' : 'ies'}) = {formatIDR(props.overtimePay)}
          </Descriptions.Item>
          {sickDays > 0 && (
            <Descriptions.Item label="Sick leave">
              {sickDays} day(s) ({detail.sickLeaveIds.length} request
              {detail.sickLeaveIds.length === 1 ? '' : 's'}) = -{formatIDR(sickDeduction)}
            </Descriptions.Item>
          )}
          {unpaidDays > 0 && (
            <Descriptions.Item label="Unpaid leave">
              {unpaidDays} day(s) ({unpaidLeaveIds.length} request
              {unpaidLeaveIds.length === 1 ? '' : 's'}) = -{formatIDR(unpaidDeduction)}
            </Descriptions.Item>
          )}
          <Descriptions.Item label="Leave deduction">
            -{formatIDR(props.leaveDeduction)}
          </Descriptions.Item>
        </>
      ) : (
        <>
          <Descriptions.Item label="Hourly rate">{formatIDR(detail.hourlyRate)}</Descriptions.Item>
          <Descriptions.Item label="Logged hours">
            {detail.dailyLogHours} h ({detail.dailyLogIds.length} log
            {detail.dailyLogIds.length === 1 ? '' : 's'}) = {formatIDR(props.basicSalary)}
          </Descriptions.Item>
        </>
      )}

      <Descriptions.Item label="Reimbursements">
        {detail.reimbursementIds.length} approved = {formatIDR(props.reimbursementTotal)}
      </Descriptions.Item>
      <Descriptions.Item label="Total (IDR)">
        <strong>{formatIDR(props.totalIdr)}</strong>
      </Descriptions.Item>
      <Descriptions.Item label="Total (USD)">
        <strong>{formatUSD(props.totalUsd)}</strong>
      </Descriptions.Item>
    </Descriptions>
  );
}
