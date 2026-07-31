import { useMemo, useState } from 'react';
import { Avatar, Button, Layout, Menu, Space, Tag, Tooltip, Typography, type MenuProps } from 'antd';
import {
  BankOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ScheduleOutlined,
  SolutionOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import LogoMark from '../components/LogoMark';
import NotificationBell from '../components/NotificationBell';
import SidebarNotifications from '../components/SidebarNotifications';

const { Header, Sider, Content } = Layout;

type NavItem = Required<MenuProps>['items'][number];

// Nav is built per role; part-time employees log daily activity, full-time submit overtime.
function buildNavItems(
  roleName: string,
  employmentType: 'FULL_TIME' | 'PART_TIME' | undefined,
): NavItem[] {
  if (roleName === 'HR') {
    return [
      { key: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
      { key: '/employees', label: 'Employees', icon: <TeamOutlined /> },
      { key: '/leave', label: 'All Leave', icon: <CalendarOutlined /> },
      { key: '/holidays', label: 'Holidays', icon: <ScheduleOutlined /> },
      { key: '/daily-logs', label: 'Daily Logs', icon: <FileTextOutlined /> },
      { key: '/overtime', label: 'Overtime', icon: <ClockCircleOutlined /> },
      { key: '/reimbursements', label: 'Reimbursements', icon: <DollarOutlined /> },
      { key: '/payroll', label: 'Payroll', icon: <BankOutlined /> },
      { key: '/users', label: 'Users', icon: <UserOutlined /> },
    ];
  }

  const items: NavItem[] = [
    { key: '/dashboard', label: 'Dashboard', icon: <DashboardOutlined /> },
    { key: '/my-leave', label: 'My Leave', icon: <CalendarOutlined /> },
    { key: '/holidays', label: 'Holidays', icon: <ScheduleOutlined /> },
  ];
  if (employmentType === 'PART_TIME') {
    items.push({ key: '/my-daily-log', label: 'Daily Log', icon: <FileTextOutlined /> });
  }
  if (employmentType === 'FULL_TIME') {
    items.push({ key: '/my-overtime', label: 'Overtime', icon: <ClockCircleOutlined /> });
  }
  items.push(
    { key: '/my-reimbursements', label: 'Reimbursements', icon: <DollarOutlined /> },
    { key: '/my-payslips', label: 'My Payslips', icon: <BankOutlined /> },
    { key: '/profile', label: 'Profile', icon: <SolutionOutlined /> },
  );
  return items;
}

// Up to two initials from a name, falling back to the first email character.
function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'U';
  const initials = words.slice(0, 2).map((word) => word[0]).join('');
  return initials.toUpperCase();
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = useMemo(
    () => buildNavItems(user?.roleName ?? '', user?.employee?.employmentType),
    [user?.roleName, user?.employee?.employmentType],
  );

  // Highlight by first path segment so /employees/:id keeps Employees active.
  const selectedKey = `/${location.pathname.split('/')[1] ?? ''}`;
  const displayName = user?.employee?.nickname ?? user?.employee?.fullName ?? user?.email ?? '';
  const initials = getInitials(displayName);
  const roleTagColor = user?.roleName === 'HR' ? 'geekblue' : 'green';

  function handleLogout(): void {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        width={232}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        style={{
          background: '#fff',
          borderInlineEnd: '1px solid #E5E7EB',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Brand block, aligned with the 56px header + its border. */}
          <div
            style={{
              height: 57,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: collapsed ? 0 : '0 16px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              borderBottom: '1px solid #E5E7EB',
            }}
          >
            <LogoMark />
            {!collapsed && (
              <div style={{ lineHeight: 1.25, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 16, color: '#1F2937' }}>HRMS</div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>Aisahub Inc</div>
              </div>
            )}
          </div>

          {/* Nav scrolls independently so the user block stays pinned. */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 8 }}>
            <Menu
              theme="light"
              mode="inline"
              selectedKeys={[selectedKey]}
              items={navItems}
              onClick={({ key }) => navigate(key)}
              style={{ borderInlineEnd: 'none' }}
            />
          </div>

          {/* Pinned above the user block, deliberately outside the module nav above. */}
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid #E5E7EB',
              padding: collapsed ? '8px' : '8px 12px',
            }}
          >
            <SidebarNotifications collapsed={collapsed} />
          </div>

          {/* Bottom-pinned user block + explicit logout. */}
          <div
            style={{
              flexShrink: 0,
              borderTop: '1px solid #E5E7EB',
              padding: collapsed ? '12px 8px' : 12,
            }}
          >
            {collapsed ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <Avatar size={32} style={{ backgroundColor: '#0F766E' }}>
                  {initials}
                </Avatar>
                <Tooltip title="Log out" placement="right">
                  <Button type="text" danger icon={<LogoutOutlined />} onClick={handleLogout} />
                </Tooltip>
              </div>
            ) : (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar size={32} style={{ backgroundColor: '#0F766E', flexShrink: 0 }}>
                    {initials}
                  </Avatar>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: '#1F2937',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {displayName}
                    </div>
                    <Tag
                      color={roleTagColor}
                      style={{ marginInlineEnd: 0, marginTop: 2, fontSize: 11, lineHeight: '16px' }}
                    >
                      {user?.roleName}
                    </Tag>
                  </div>
                </div>
                <Button
                  type="text"
                  danger
                  icon={<LogoutOutlined />}
                  onClick={handleLogout}
                  style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                >
                  Log out
                </Button>
              </Space>
            )}
          </div>
        </div>
      </Sider>

      <Layout style={{ minHeight: '100vh' }}>
        <Header
          style={{
            height: 56,
            lineHeight: '56px',
            background: '#fff',
            borderBottom: '1px solid #E5E7EB',
            padding: '0 16px 0 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Button
            type="text"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
          />
          <Space size={12}>
            <NotificationBell />
            <Tag color={roleTagColor} style={{ marginInlineEnd: 0 }}>
              {user?.roleName}
            </Tag>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size={28} style={{ backgroundColor: '#0F766E' }}>
                {initials}
              </Avatar>
              <Typography.Text strong>{displayName}</Typography.Text>
            </div>
          </Space>
        </Header>
        <Content style={{ padding: 24 }}>
          <div key={location.pathname} className="page-transition">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
