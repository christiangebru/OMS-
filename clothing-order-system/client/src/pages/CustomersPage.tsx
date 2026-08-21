import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, ErrorState, EmptyState, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders } from "@/lib/roles";
import { RowActions } from "@/components/RowActions";

export function CustomersPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
        const data = await apiJson<Customer[]>(`/api/customers${qs}`);
        if (!cancelled) setCustomers(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 200 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Find someone by name, phone, or email, then open their profile."
        actions={
          canWriteOrders(user?.role) ? (
            <Link to="/orders/new">
              <Button>New order</Button>
            </Link>
          ) : undefined
        }
      />

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, phone, or email…"
        className="ui-input max-w-md"
        aria-label="Search customers"
      />

      {err && <ErrorState message={err} />}
      {loading ? (
        <Skeleton className="h-40" />
      ) : customers.length === 0 ? (
        <EmptyState title="No customers match" body="Try a shorter name or phone number." />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {customers.map((c) => (
              <li key={c._id} className="ui-card flex items-start justify-between gap-3 p-4">
                <Link to={`/customers/${c._id}`} className="min-w-0 flex-1">
                  <p className="font-medium text-ink">{c.name}</p>
                  <p className="text-sm text-ink-muted">{c.phone}{c.email ? ` · ${c.email}` : ""}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {c.orderCount ?? 0} order{(c.orderCount || 0) === 1 ? "" : "s"}
                    {c.activeGarmentCount ? ` · ${c.activeGarmentCount} in production` : " · idle"}
                    {c.lastOrderDate ? ` · last ${formatDate(c.lastOrderDate)}` : ""}
                    {(c.outstandingBalance || 0) > 0 ? ` · ${formatMoney(c.outstandingBalance)} due` : ""}
                  </p>
                </Link>
                <RowActions
                  actions={[
                    { label: "View", to: `/customers/${c._id}` },
                    { label: "Edit", hidden: !canWriteOrders(user?.role), to: `/customers/${c._id}` },
                    {
                      label: "New order",
                      hidden: !canWriteOrders(user?.role),
                      to: `/orders/new?customerId=${c._id}`
                    }
                  ]}
                />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden ui-card md:block">
          <table className="ui-table min-w-full text-sm">
            <thead className="bg-canvas">
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Orders</th>
                <th>Active</th>
                <th>Last order</th>
                <th>Status</th>
                <th>Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c._id} className="border-t border-line">
                  <td className="font-medium text-ink">{c.name}</td>
                  <td className="text-ink-muted">{c.phone}</td>
                  <td className="text-xs text-ink-muted">{c.email || "—"}</td>
                  <td className="tabular">{c.orderCount ?? 0}</td>
                  <td className="tabular">{c.activeGarmentCount ?? 0}</td>
                  <td className="text-xs text-ink-muted">{formatDate(c.lastOrderDate)}</td>
                  <td className="text-xs text-ink-muted">
                    {(c.activeGarmentCount || 0) > 0 ? "In production" : "Idle"}
                  </td>
                  <td className="tabular text-xs">{formatMoney(c.outstandingBalance)}</td>
                  <td className="text-right">
                    <RowActions
                      actions={[
                        { label: "View", to: `/customers/${c._id}` },
                        { label: "Edit", hidden: !canWriteOrders(user?.role), to: `/customers/${c._id}` },
                        {
                          label: "New order",
                          hidden: !canWriteOrders(user?.role),
                          to: `/orders/new?customerId=${c._id}`
                        }
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}
