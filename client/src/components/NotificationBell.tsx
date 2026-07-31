import { useEffect } from 'react';
import { Badge, Button, Tooltip } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUnreadCount } from '../api/notifications';

// A badge and a link to /notifications, nothing more. This used to open a drawer holding
// its own copy of the list; that duplicated the notifications page for no benefit once the
// sidebar gained an entry of its own, so the drawer went and the page is the only surface.
export default function NotificationBell() {
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadCount();

  // The count polls every 30s on its own; this refreshes it on navigation too.
  const refetchUnread = unread.refetch;
  useEffect(() => {
    refetchUnread();
  }, [location.pathname, refetchUnread]);

  const count = unread.data?.count ?? 0;
  const active = location.pathname === '/notifications';

  return (
    <Tooltip title="Notifications">
      <Badge count={count} size="small" offset={[-2, 2]}>
        <Button
          type="text"
          aria-label="Notifications"
          icon={<BellOutlined style={{ fontSize: 18 }} />}
          onClick={() => navigate('/notifications')}
          style={{ color: active ? '#0F766E' : undefined }}
        />
      </Badge>
    </Tooltip>
  );
}
