import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider, type ThemeConfig } from 'antd';
import App from './App.tsx';
import { AuthProvider } from './lib/AuthContext';

const queryClient = new QueryClient();

// Restrained, professional theme for Aisahub Inc — deep teal brand, light surfaces.
const theme: ThemeConfig = {
  token: {
    colorPrimary: '#0F766E',
    colorLink: '#0F766E',
    colorBgLayout: '#F5F7FA',
    colorText: '#1F2937',
    colorTextSecondary: '#6B7280',
    colorBorderSecondary: '#E5E7EB',
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "'Inter Variable', -apple-system, 'Segoe UI', sans-serif",
  },
  components: {
    Card: { paddingLG: 20 },
    Table: { headerBg: '#FAFAFA' },
    Menu: {
      itemSelectedBg: '#F0FDFA',
      itemSelectedColor: '#0F766E',
    },
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={theme}>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </StrictMode>,
);
