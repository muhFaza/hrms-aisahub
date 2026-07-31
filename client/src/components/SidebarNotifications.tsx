import { useState } from 'react';
import { Badge, Button, Tooltip } from 'antd';
import { BellOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRefreshNotifications, useUnreadCount } from '../api/notifications';

// Pinned above the user block rather than sitting in the main nav: notifications are a
// place you go to when something happened, not part of the module list you navigate by.
export default function SidebarNotifications({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const unread = useUnreadCount();
  const refresh = useRefreshNotifications();
  const [spinning, setSpinning] = useState(false);

  const count = unread.data?.count ?? 0;
  const active = location.pathname === '/notifications';

  // The spin is decoupled from any one query: invalidation refreshes whatever is mounted,
  // so there is no single promise to await. A fixed beat reads as "it did something".
  const handleRefresh = () => {
    refresh();
    setSpinning(true);
    window.setTimeout(() => setSpinning(false), 600);
  };

  if (collapsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <Tooltip title="Notifications" placement="right">
          {/* The badge overflows the button box, so it needs enough downward offset to
              clear the section's top border rather than sitting across it. */}
          <Badge count={count} size="small" offset={[-2, 8]}>
            <Button
              type="text"
              icon={<BellOutlined />}
              onClick={() => navigate('/notifications')}
              style={{
                color: active ? '#0F766E' : undefined,
                background: active ? '#F0FDFA' : undefined,
              }}
            />
          </Badge>
        </Tooltip>
        <Tooltip title="Refresh notifications" placement="right">
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined spin={spinning} />}
            onClick={handleRefresh}
            aria-label="Refresh notifications"
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <Button
        type="text"
        icon={<BellOutlined />}
        onClick={() => navigate('/notifications')}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: 'left',
          justifyContent: 'flex-start',
          color: active ? '#0F766E' : undefined,
          background: active ? '#F0FDFA' : undefined,
          fontWeight: active ? 500 : undefined,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Notifications
          </span>
          {count > 0 && <Badge count={count} size="small" />}
        </span>
      </Button>
      <Tooltip title="Refresh notifications">
        <Button
          type="text"
          icon={<ReloadOutlined spin={spinning} />}
          onClick={handleRefresh}
          aria-label="Refresh notifications"
          style={{ flexShrink: 0 }}
        />
      </Tooltip>
    </div>
  );
}
