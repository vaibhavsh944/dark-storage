import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/authStore.js';
import { AppShell } from './components/AppShell.js';
import { RequirePerm } from './components/RequirePerm.js';
import { LoginPage } from './pages/LoginPage.js';
import { HomePage } from './pages/HomePage.js';
import { InventoryPage } from './pages/InventoryPage.js';
import { WarehousePage } from './pages/WarehousePage.js';
import { ReceivingPage } from './pages/ReceivingPage.js';
import { TasksPage } from './pages/TasksPage.js';
import { OrdersPage } from './pages/OrdersPage.js';
import { NewOrderPage } from './pages/NewOrderPage.js';
import { OrderDetailPage } from './pages/OrderDetailPage.js';
import { PickingPage } from './pages/PickingPage.js';
import { MissionDetailPage } from './pages/MissionDetailPage.js';
import { ExceptionsPage } from './pages/ExceptionsPage.js';
import { PackingPage } from './pages/PackingPage.js';
import { AdminPage } from './pages/AdminPage.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true
    }
  }
});

const ProtectedLayout: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <AppShell />;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedLayout />}>
            <Route path="/" element={<RequirePerm perm="control:view"><HomePage /></RequirePerm>} />
            <Route path="/inventory" element={<RequirePerm perm="inventory:view"><InventoryPage /></RequirePerm>} />
            <Route path="/warehouse" element={<RequirePerm perm="inventory:view"><WarehousePage /></RequirePerm>} />
            <Route path="/receiving" element={<RequirePerm perm="inbound:receive"><ReceivingPage /></RequirePerm>} />
            <Route path="/orders" element={<RequirePerm perm="order:view"><OrdersPage /></RequirePerm>} />
            <Route path="/orders/new" element={<RequirePerm perm="order:create"><NewOrderPage /></RequirePerm>} />
            <Route path="/orders/:ref" element={<RequirePerm perm="order:view"><OrderDetailPage /></RequirePerm>} />
            <Route path="/picking" element={<RequirePerm perm="pick:execute"><PickingPage /></RequirePerm>} />
            <Route path="/picking/:ref" element={<RequirePerm perm="pick:execute"><MissionDetailPage /></RequirePerm>} />
            <Route path="/packing" element={<RequirePerm perm="pack:execute"><PackingPage /></RequirePerm>} />
            <Route path="/exceptions" element={<RequirePerm perm="exception:view"><ExceptionsPage /></RequirePerm>} />
            <Route path="/tasks" element={<RequirePerm perm="control:view"><TasksPage /></RequirePerm>} />
            <Route path="/admin" element={<RequirePerm perm="audit:view"><AdminPage /></RequirePerm>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};
