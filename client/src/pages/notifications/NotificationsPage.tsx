import { useState } from 'react';
import { Button, Card, Empty, List, Space, Switch, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
  type AppNotification,
} from '../../api/notifications';
import { getNotificationCopy } from '../../lib/notificationCopy';
import NotificationListItem from '../../components/NotificationListItem';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isFetching, refetch } = useNotifications({ unreadOnly, page, pageSize });
  const unread = useUnreadCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  function handleSync(): void {
    refetch();
    unread.refetch();
  }

  function handleSelect(notification: AppNotification): void {
    if (notification.readAt === null) {
      markRead.mutate(notification.id);
    }
    navigate(getNotificationCopy(notification).link);
  }

  return (
    <Card
      title={
        <Typography.Title level={5} style={{ margin: 0 }}>
          Notifications
        </Typography.Title>
      }
      extra={
        <Space>
          <Button
            icon={<ReloadOutlined />}
            loading={isFetching || unread.isFetching}
            onClick={handleSync}
          >
            Sync
          </Button>
          <Button
            disabled={(unread.data?.count ?? 0) === 0}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
          >
            Mark all read
          </Button>
        </Space>
      }
    >
      <Space style={{ marginBottom: 16 }}>
        <Switch
          checked={unreadOnly}
          onChange={(checked) => {
            setUnreadOnly(checked);
            setPage(1);
          }}
        />
        <Typography.Text>Unread only</Typography.Text>
      </Space>

      <List
        loading={isLoading}
        dataSource={data?.data ?? []}
        locale={{ emptyText: <Empty description="No notifications" /> }}
        renderItem={(notification) => (
          <NotificationListItem notification={notification} onSelect={handleSelect} />
        )}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }}
      />
    </Card>
  );
}
