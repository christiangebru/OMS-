import { lazy, Suspense, useEffect, useState, type ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { AppLayout } from "@/components/Layout/AppLayout";
import { Button } from "@/components/ui/Button";
import { AUTH_RESTORE_TIMEOUT_MS } from "@/lib/fetchTimeout.js";
import { canSee, canWriteOrders, isManagerRole } from "@/lib/roles";

const LoginPage = lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const OrdersPage = lazy(() => import("@/pages/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const GroupDetailPage = lazy(() =>
  import("@/pages/GroupDetailPage").then((m) => ({ default: m.GroupDetailPage }))
);
const OrderEditPage = lazy(() => import("@/pages/OrderEditPage").then((m) => ({ default: m.OrderEditPage })));
const OrderDetailPage = lazy(() => import("@/pages/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })));
const GarmentPage = lazy(() => import("@/pages/GarmentPage").then((m) => ({ default: m.GarmentPage })));
const NewOrderPage = lazy(() => import("@/pages/NewOrderPage").then((m) => ({ default: m.NewOrderPage })));
const CustomersPage = lazy(() => import("@/pages/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const CustomerDetailPage = lazy(() =>
  import("@/pages/CustomerDetailPage").then((m) => ({ default: m.CustomerDetailPage }))
);
const StaffPage = lazy(() => import("@/pages/StaffPage").then((m) => ({ default: m.StaffPage })));
const StaffDetailPage = lazy(() =>
  import("@/pages/StaffDetailPage").then((m) => ({ default: m.StaffDetailPage }))
);
const PrintLabelsPage = lazy(() =>
  import("@/pages/PrintLabelsPage").then((m) => ({ default: m.PrintLabelsPage }))
);
const LabelsWorkspacePage = lazy(() =>
  import("@/pages/PrintLabelsPage").then((m) => ({ default: m.LabelsWorkspacePage }))
);
const ScanPage = lazy(() => import("@/pages/ScanPage").then((m) => ({ default: m.ScanPage })));
const ProductionFloorPage = lazy(() =>
  import("@/pages/ProductionFloorPage").then((m) => ({ default: m.ProductionFloorPage }))
);
const DistributionPage = lazy(() =>
  import("@/pages/DistributionPage").then((m) => ({ default: m.DistributionPage }))
);
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));

function Boot() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="h-8 w-8 animate-pulse rounded-full bg-line" />
    </div>
  );
}

function Protected({ children }: { children: ReactElement }) {
  const { user, loading, logout } = useAuth();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!loading) {
      setStalled(false);
      return;
    }
    const id = window.setTimeout(() => setStalled(true), AUTH_RESTORE_TIMEOUT_MS + 1500);
    return () => window.clearTimeout(id);
  }, [loading]);

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6">
        <div className="h-8 w-8 animate-pulse rounded-full bg-line" />
        <p className="mt-4 text-center text-sm text-ink-muted">
          {stalled ? "Having trouble connecting to the server." : "Restoring your session…"}
        </p>
        {stalled && (
          <Button
            type="button"
            variant="secondary"
            className="mt-6"
            onClick={() =>
              logout("Having trouble connecting to the server. Please sign in again.")
            }
          >
            Return to sign in
          </Button>
        )}
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

function ProductionOnly({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (!canSee(user?.role, "production")) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Suspense fallback={<Boot />}>
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
          <Route index element={<DashboardPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/groups/:id" element={<GroupDetailPage />} />
          <Route
            path="orders/new"
            element={
              <WriterOnly>
                <NewOrderPage />
              </WriterOnly>
            }
          />
          <Route path="orders/:orderId" element={<OrderDetailPage />} />
          <Route
            path="orders/:orderId/edit"
            element={
              <WriterOnly>
                <OrderEditPage />
              </WriterOnly>
            }
          />
          <Route path="garments/:itemId" element={<GarmentPage />} />
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
          <Route path="scanner" element={<Navigate to="/scan" replace />} />
          <Route
            path="production"
            element={
              <ProductionOnly>
                <ProductionFloorPage />
              </ProductionOnly>
            }
          />
          <Route path="floor" element={<Navigate to="/production" replace />} />
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
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
