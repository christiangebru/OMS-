import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order, OrderGroup } from "@/lib/types";
import { formatDate, formatMoney, shortOrderId, stageLabel } from "@/lib/format";
import { PageHeader, ErrorState, Skeleton, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/context/AuthContext";
import { canWriteOrders } from "@/lib/roles";
import { useToast } from "@/context/ToastContext";

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { push } = useToast();
  const navigate = useNavigate();
  const canEdit = canWriteOrders(user?.role);
  const [group, setGroup] = useState<OrderGroup | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [responsibleName, setResponsibleName] = useState("");
  const [responsiblePhone, setResponsiblePhone] = useState("");
  const [notes, setNotes] = useState("");
  const [addOrderId, setAddOrderId] = useState("");

  async function load() {
    if (!id) return;
    try {
      const data = await apiJson<OrderGroup>(`/api/order-groups/${id}`);
      setGroup(data);
      setName(data.name);
      setResponsibleName(data.responsibleName || "");
      setResponsiblePhone(data.responsiblePhone || "");
      setNotes(data.notes || "");
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not load group");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    if (!id) return;
    try {
      const updated = await apiJson<OrderGroup>(`/api/order-groups/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, responsibleName, responsiblePhone, notes })
      });
      setGroup({ ...group, ...updated, orders: group?.orders });
      setEditing(false);
      push("Group updated", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not update group");
    }
  }

  async function addOrder() {
    if (!id || !addOrderId.trim()) return;
    try {
      await apiJson(`/api/order-groups/${id}/orders`, {
        method: "POST",
        body: JSON.stringify({ orderId: addOrderId.trim() })
      });
      setAddOrderId("");
      await load();
      push("Order added to group", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add order");
    }
  }

  async function removeOrder(order: Order) {
    if (!id) return;
    if (
      !window.confirm(
        `Remove ${order.orderId} from this group? The order itself stays in the system as an independent order.`
      )
    ) {
      return;
    }
    try {
      await apiJson(`/api/order-groups/${id}/orders/${encodeURIComponent(order.orderId)}`, {
        method: "DELETE"
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove order");
    }
  }

  if (err && !group) return <ErrorState title="Group API failed" message={err} onRetry={load} />;
  if (!group) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={group.name}
        description={`${group.orderCount || group.orders?.length || 0} independent orders · ${group.status || ""}`}
        actions={
          canEdit ? (
            <Button type="button" variant="secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel" : "Edit group"}
            </Button>
          ) : undefined
        }
      />
      {err && <ErrorState message={err} />}

      <section className="border border-line bg-surface p-4 text-sm">
        <p>
          {group.responsibleName || "—"} {group.responsiblePhone ? `· ${group.responsiblePhone}` : ""}
        </p>
        {group.earliestDue && <p className="mt-1 text-ink-muted">Shared / earliest due {formatDate(group.earliestDue)}</p>}
        {(group.outstanding || 0) > 0 && (
          <p className="mt-1 text-ink-muted">{formatMoney(group.outstanding)} outstanding</p>
        )}
        <p className="mt-2 text-ink-muted">{group.notes || group.description || ""}</p>
      </section>

      {editing && (
        <div className="grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="ui-label">Group name</span>
            <input className="ui-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="ui-label">Responsible</span>
            <input className="ui-input" value={responsibleName} onChange={(e) => setResponsibleName(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="ui-label">Phone</span>
            <input className="ui-input" value={responsiblePhone} onChange={(e) => setResponsiblePhone(e.target.value)} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="ui-label">Notes</span>
            <textarea className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <Button type="button" onClick={save}>
            Save
          </Button>
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            className="ui-input max-w-xs"
            placeholder="Add existing ORD-…"
            value={addOrderId}
            onChange={(e) => setAddOrderId(e.target.value)}
          />
          <Button type="button" variant="secondary" onClick={addOrder}>
            Add order to group
          </Button>
          <Button type="button" onClick={() => navigate(`/orders/new?groupId=${group._id}`)}>
            New order in this group
          </Button>
        </div>
      )}

      {!group.orders?.length ? (
        <EmptyState title="No orders in this group yet" />
      ) : (
        <ul className="divide-y divide-line border border-line bg-surface">
          {group.orders.map((o) => (
            <li key={o.orderId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link to={`/orders/${encodeURIComponent(o.orderId)}`} className="min-w-0">
                <p className="font-mono text-xs font-semibold">{shortOrderId(o.orderId)}</p>
                <p className="text-sm font-medium text-ink">{o.customerName || o.customer?.name}</p>
                <p className="text-xs text-ink-muted">
                  {o.items.map((it) => `${it.clothingType}${it.currentStage ? ` · ${stageLabel(it.currentStage)}` : ""}`).join(" · ")}
                </p>
              </Link>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span>{formatDate(o.requiredCompletionDate)}</span>
                {canEdit && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeOrder(o)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
