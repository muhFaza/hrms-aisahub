import dayjs from 'dayjs';

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export function formatIDR(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return idrFormatter.format(Number(value));
}

export function formatUSD(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  return usdFormatter.format(Number(value));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  return dayjs(value).format('DD MMM YYYY');
}

// Payroll period label, e.g. (2026, 6) → "June 2026".
export function formatPeriod(year: number, month: number): string {
  return dayjs(new Date(year, month - 1, 1)).format('MMMM YYYY');
}
