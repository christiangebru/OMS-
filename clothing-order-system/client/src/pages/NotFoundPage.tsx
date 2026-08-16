import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";

export function NotFoundPage() {
  const loc = useLocation();
  return (
    <div className="mx-auto max-w-lg space-y-6 py-8">
      <PageHeader
        title="This page is not in the app"
        description={`${loc.pathname} is not a registered screen. This is a missing frontend route, not a missing API.`}
      />
      <p className="text-sm text-ink-muted">
        If you expected a production tool here, use Floor, Scanner, Distribution, or Labels from the sidebar.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to="/">
          <Button>Overview</Button>
        </Link>
        <Link to="/orders">
          <Button variant="secondary">Orders</Button>
        </Link>
        <Link to="/production">
          <Button variant="secondary">Production floor</Button>
        </Link>
      </div>
    </div>
  );
}
