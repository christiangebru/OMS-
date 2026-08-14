import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/Layout/AppLayout";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { OrdersPage } from "@/pages/OrdersPage";
import { OrderEditPage } from "@/pages/OrderEditPage";
import { NewOrderPage } from "@/pages/NewOrderPage";
import { CustomersPage } from "@/pages/CustomersPage";
import { CustomerDetailPage } from "@/pages/CustomerDetailPage";
import { StaffPage } from "@/pages/StaffPage";
import { StaffDetailPage } from "@/pages/StaffDetailPage";
import { LabelsWorkspacePage, PrintLabelsPage } from "@/pages/PrintLabelsPage";
import { ScanPage } from "@/pages/ScanPage";
import { DistributionPage } from "@/pages/DistributionPage";
import type { ReactElement } from "react";
import { canSee, canWriteOrders, isManagerRole } from "@/lib/roles";

function Protected({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="h-8 w-8 animate-pulse rounded-full bg-line" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function ManagerOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!isManagerRole(user?.role)) return <Navigate to="/scan" replace />;
  return children;
}

function HomeRoute() {
  return <DashboardPage />;
}

function WriterOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!canWriteOrders(user?.role)) return <Navigate to="/orders" replace />;
  return children;
}

function LabelsOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!canSee(user?.role, "labels")) return <Navigate to="/scan" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/orders/:orderId/print-labels"
        element={
          <Protected>
            <PrintLabelsPage />
          </Protected>
        }
      />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route
          path="orders/new"
          element={
            <WriterOnly>
              <NewOrderPage />
            </WriterOnly>
          }
        />
        <Route path="orders/:orderId" element={<OrderEditPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerDetailPage />} />
        <Route
          path="staff"
          element={
            <ManagerOnly>
              <StaffPage />
            </ManagerOnly>
          }
        />
        <Route
          path="staff/:id"
          element={
            <ManagerOnly>
              <StaffDetailPage />
            </ManagerOnly>
          }
        />
        <Route path="scan" element={<ScanPage />} />
        <Route
          path="distribution"
          element={
            <ManagerOnly>
              <DistributionPage />
            </ManagerOnly>
          }
        />
        <Route
          path="labels"
          element={
            <LabelsOnly>
              <LabelsWorkspacePage />
            </LabelsOnly>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
