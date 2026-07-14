import { useState } from 'react';
import { Alert, Button, Card, Divider, Form, Input, List, Tag, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import LogoMark from '../components/LogoMark';
import { AxiosError } from 'axios';

interface LoginFormValues {
  email: string;
  password: string;
}

interface DemoAccount {
  email: string;
  name: string;
  tag: string;
  color: string;
}

const DEMO_PASSWORD = 'password123';

const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'hr@aisahub.com', name: 'HR Admin', tag: 'HR', color: 'volcano' },
  { email: 'owner@aisahub.com', name: 'Owner', tag: 'HR', color: 'volcano' },
  { email: 'budi@aisahub.com', name: 'Budi Santoso', tag: 'Full-time', color: 'blue' },
  { email: 'sari@aisahub.com', name: 'Sari Wulandari', tag: 'Full-time', color: 'blue' },
  { email: 'andi@aisahub.com', name: 'Andi Pratama', tag: 'Part-time', color: 'green' },
  { email: 'dewi@aisahub.com', name: 'Dewi Lestari', tag: 'Part-time', color: 'green' },
];

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm<LoginFormValues>();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Which demo account is currently signing in (null when idle).
  const [demoLoading, setDemoLoading] = useState<string | null>(null);

  // Already signed in — both roles land on the dashboard.
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  async function doLogin(email: string, password: string): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const axiosError = err as AxiosError<{ error?: string }>;
      setError(axiosError.response?.data?.error ?? 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onFinish(values: LoginFormValues): Promise<void> {
    await doLogin(values.email, values.password);
  }

  async function onDemoClick(account: DemoAccount): Promise<void> {
    if (submitting) return;
    // Fill the form so the tester sees the credentials, then submit.
    form.setFieldsValue({ email: account.email, password: DEMO_PASSWORD });
    setDemoLoading(account.email);
    try {
      await doLogin(account.email, DEMO_PASSWORD);
    } finally {
      setDemoLoading(null);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F7FA',
        padding: 24,
      }}
    >
      <Card style={{ width: 460, border: '1px solid #E5E7EB', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            <LogoMark size={44} />
          </div>
          <Typography.Title level={3} style={{ marginBottom: 0 }}>
            HRMS
          </Typography.Title>
          <Typography.Text type="secondary">Aisahub Inc · Human Resource Management System</Typography.Text>
        </div>
        {error && (
          <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} closable />
        )}
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          requiredMark={false}
          disabled={submitting}
        >
          <Form.Item
            name="email"
            label="Email"
            rules={[
              { required: true, message: 'Please enter your email' },
              { type: 'email', message: 'Please enter a valid email' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="you@aisahub.com" size="large" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
              Sign In
            </Button>
          </Form.Item>
        </Form>

        <Divider plain style={{ fontSize: 12, color: '#8c8c8c', margin: '16px 0' }}>
          Demo accounts — click to sign in
        </Divider>
        <List
          size="small"
          split={false}
          grid={{ column: 2, gutter: 8 }}
          dataSource={DEMO_ACCOUNTS}
          renderItem={(account) => {
            const loading = demoLoading === account.email;
            return (
              <List.Item
                onClick={() => void onDemoClick(account)}
                style={{
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  padding: '6px 8px',
                  marginBottom: 8,
                  border: '1px solid #E5E7EB',
                  borderRadius: 6,
                  opacity: submitting && !loading ? 0.5 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Typography.Text style={{ fontSize: 13 }}>{account.name}</Typography.Text>
                    <br />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {account.email}
                    </Typography.Text>
                  </div>
                  <Tag color={account.color} style={{ marginInlineEnd: 0 }}>
                    {loading ? 'Signing in…' : account.tag}
                  </Tag>
                </div>
              </List.Item>
            );
          }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          Demo credentials — all accounts use password <Typography.Text code>password123</Typography.Text>.
        </Typography.Text>
      </Card>
    </div>
  );
}
