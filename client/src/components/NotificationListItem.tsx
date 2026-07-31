import { List, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { AppNotification } from '../api/notifications';
import { getNotificationCopy } from '../lib/notificationCopy';

interface Props {
  notification: AppNotification;
  onSelect: (notification: AppNotification) => void;
}

// Row for the notifications page: unread rows are emphasized, resolved ones dimmed
// since another HR already handled them.
export default function NotificationListItem({ notification, onSelect }: Props) {
  const copy = getNotificationCopy(notification);
  const unread = notification.readAt === null;
  const resolved = notification.resolvedAt !== null;

  return (
    <List.Item
      onClick={() => onSelect(notification)}
      style={{
        cursor: 'pointer',
        opacity: resolved ? 0.55 : 1,
        background: unread ? '#F0FDFA' : undefined,
        paddingInline: 12,
      }}
    >
      <List.Item.Meta
        avatar={<span style={{ fontSize: 18, color: '#0F766E' }}>{copy.icon}</span>}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong={unread}>{copy.title}</Typography.Text>
            {unread && <Tag color="green">New</Tag>}
          </div>
        }
        description={
          <div style={{ lineHeight: 1.5 }}>
            {copy.description && (
              <Typography.Text type="secondary">{copy.description}</Typography.Text>
            )}
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              {dayjs(notification.createdAt).format('DD MMM YYYY HH:mm')}
              {resolved && ` · Handled by ${notification.resolvedByName ?? 'HR'}`}
            </div>
          </div>
        }
      />
    </List.Item>
  );
}
