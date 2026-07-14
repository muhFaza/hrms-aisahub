import { Result } from 'antd';

// Shared stand-in for modules delivered in Phases 3-6.
export default function PlaceholderPage({ title }: { title: string }) {
  return <Result status="info" title={title} subTitle="Coming in a later phase." />;
}
