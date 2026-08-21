import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { PageErrorBoundary } from "../PageErrorBoundary";

export function AppLayout() {
  return (
    <div className="flex min-h-screen bg-canvas print:min-h-0 print:bg-white">
      <div className="print:hidden">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col print:bg-white">
        <div className="print:hidden">
          <Header />
        </div>
        <main className="flex-1 overflow-auto bg-canvas p-4 sm:p-6 lg:p-8 print:overflow-visible print:bg-white print:p-0">
          <div className="mx-auto max-w-7xl animate-fade-in print:max-w-none print:bg-white">
            <PageErrorBoundary>
              <Outlet />
            </PageErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
