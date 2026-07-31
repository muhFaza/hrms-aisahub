import { useEffect, useState } from 'react';
import { Badge, Button, Drawer, Empty, List, Space, Tooltip } from 'antd';
import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
  type AppNotification,
} from '../api/notifications';
import { getNotificationCopy } from '../lib/notificationCopy';
import NotificationListItem from './NotificationListItem';

const DRAWER_PAGE_SIZE = 10;

export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  // The count polls every 30s on its own; the list is only fetched while open.
  const unread = useUnreadCount();
  const list = useNotifications({ page: 1, pageSize: DRAWER_PAGE_SIZE }, open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const refetchUnread = unread.refetch;
  useEffect(() => {
    refetchUnread();
  }, [location.pathname, refetchUnread]);

  function handleSync(): void {
    unread.refetch();
    list.refetch();
  }

  function handleSelect(notification: AppNotification): void {
    setOpen(false);
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    navigate(getNotificationCopy(notification).link);
  }

  return (
    <>
      <Badge count={unread.data?.count ?? 0} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          aria-label="Notifications"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          onClick={() => setOpen(true)}
        />
      </Badge>

      <Drawer
        title="Notifications"
        placement="right"
        width={420}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 0 } }}
        extra={
          <Tooltip title="Sync">
            <Button
              type="text"
              aria-label="Sync notifications"
              icon={<ReloadOutlined />}
              loading={list.isFetching || unread.isFetching}
              onClick={handleSync}
            />
          </Tooltip>
        }
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button
              type="link"
              disabled={(unread.data?.count ?? 0) === 0}
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              Mark all read
            </Button>
            <Button
              type="link"
              onClick={() => {
                setOpen(false);
                navigate('/notifications');
              }}
            >
              View all
            </Button>
          </Space>
        }
      >
        <List
          loading={list.isLoading}
          dataSource={list.data?.data ?? []}
          locale={{ emptyText: <Empty description="No notifications yet" /> }}
          renderItem={(notification) => (
            <NotificationListItem notification={notification} onSelect={handleSelect} />
          )}
        />
      </Drawer>
    </>
  );
}
