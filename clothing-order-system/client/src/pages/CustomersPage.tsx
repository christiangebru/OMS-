import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader, ErrorState, EmptyState, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders } from "@/lib/roles";

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
              <li key={c._id}>
                <Link to={`/customers/${c._id}`} className="ui-card block p-4">
                  <p className="font-medium text-ink">{c.name}</p>
                  <p className="text-sm text-ink-muted">{c.phone}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {c.orderCount ?? 0} order{(c.orderCount || 0) === 1 ? "" : "s"}
                    {c.lastOrderDate ? ` · last ${formatDate(c.lastOrderDate)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-hidden ui-card md:block">
          <table className="ui-table min-w-full text-sm">
            <thead className="bg-canvas">
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Orders</th>
                <th>Last order</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c._id} className="border-t border-line">
                  <td className="font-medium text-ink">
                    {c.name}
                    {c.email ? <span className="block text-xs text-ink-muted">{c.email}</span> : null}
                  </td>
                  <td className="text-ink-muted">{c.phone}</td>
                  <td className="tabular">{c.orderCount ?? 0}</td>
                  <td className="text-xs text-ink-muted">{formatDate(c.lastOrderDate)}</td>
                  <td className="text-right">
                    <Link to={`/customers/${c._id}`} className="text-xs font-semibold text-accent hover:underline">
                      Open
                    </Link>
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
