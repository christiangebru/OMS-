import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError, imageUrlFromPath } from "@/lib/api";
import type { Customer, Measurement } from "@/lib/types";
import { MEASUREMENT_SCHEMAS, type MeasurementCategory as Cat } from "@/lib/measurementSchema";
import { formatDate, formatMoney } from "@/lib/format";
import { PageHeader, ErrorState, EmptyState, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"profile" | "orders" | "garments" | "payments" | "measures">("profile");
  const [identity, setIdentity] = useState({
    name: "",
    phone: "",
    secondaryPhone: "",
    email: "",
    address: "",
    notes: ""
  });
  const [category, setCategory] = useState<Cat>("male");
  const [values, setValues] = useState<Record<string, string>>({});
  const [measureNotes, setMeasureNotes] = useState("");

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiJson<Customer>(`/api/customers/${id}`);
      setCustomer(data);
      setIdentity({
        name: data.name,
        phone: data.phone,
        secondaryPhone: data.secondaryPhone || "",
        email: data.email || "",
        address: data.address || "",
        notes: data.notes || ""
      });
      setErr(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const garments = useMemo(() => {
    const list: Array<{
      key: string;
      clothingType: string;
      orderId: string;
      createdAt: string;
      fabric?: string;
      color?: string;
      item: NonNullable<NonNullable<Customer["orders"]>[0]["items"]>[0];
    }> = [];
    for (const o of customer?.orders || []) {
      for (const it of o.items || []) {
        list.push({
          key: it._id || `${o.orderId}-${it.clothingCode}`,
          clothingType: it.clothingType,
          orderId: o.orderId,
          createdAt: o.createdAt,
          fabric: it.fabricType,
          color: it.color,
          item: it
        });
      }
    }
    return list;
  }, [customer]);

  async function saveIdentity(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    try {
      const updated = await apiJson<Customer>(`/api/customers/${id}`, {
        method: "PATCH",
        body: JSON.stringify(identity)
      });
      setCustomer((c) => (c ? { ...c, ...updated } : updated));
      push("Customer updated", "ok");
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Update failed");
    }
  }

  async function onAddMeasurement(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const schema = MEASUREMENT_SCHEMAS[category];
    const body: Record<string, unknown> = { category, notes: measureNotes, fields: {} };
    for (const group of schema) {
      for (const field of group.fields) {
        const raw = values[field.key];
        if (!raw) continue;
        const num = Number(raw);
        if (field.store === "column" && field.column) body[field.column] = num;
        else (body.fields as Record<string, number>)[field.key] = num;
      }
    }
    try {
      await apiJson(`/api/customers/${id}/measurements`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setValues({});
      setMeasureNotes("");
      push("Measurement saved", "ok");
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Failed to save measurement");
    }
  }

  if (loading) return <div className="h-24 animate-pulse rounded-xl bg-line/60" />;
  if (!customer) return <ErrorState message={err || "Not found"} />;

  const paid = (customer.orders || []).reduce((s, o) => s + (o.depositPaid || 0), 0);
  const agreed = (customer.orders || []).reduce((s, o) => s + (o.totalAgreedPrice || 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.name}
        description={`${customer.phone}${customer.email ? ` · ${customer.email}` : ""}`}
        actions={
          <>
            <Link to={`/orders/new?customerId=${customer._id}`}>
              <Button>New order</Button>
            </Link>
            <Link to="/customers">
              <Button variant="secondary">All customers</Button>
            </Link>
          </>
        }
      />

      {err && <ErrorState message={err} />}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["profile", "Profile"],
            ["orders", "Orders"],
            ["garments", "Garments"],
            ["measures", "Measurements"],
            ["payments", "Payments"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              tab === key
                ? "rounded-control bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
                : "rounded-control px-3 py-1.5 text-sm text-ink-muted hover:bg-canvas"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" && (
        <form onSubmit={saveIdentity} className="ui-card grid gap-3 p-5 sm:grid-cols-2">
          <Labeled label="Name">
            <input className="ui-input" value={identity.name} onChange={(e) => setIdentity((s) => ({ ...s, name: e.target.value }))} />
          </Labeled>
          <Labeled label="Phone">
            <input className="ui-input" value={identity.phone} onChange={(e) => setIdentity((s) => ({ ...s, phone: e.target.value }))} />
          </Labeled>
          <Labeled label="Secondary phone">
            <input className="ui-input" value={identity.secondaryPhone} onChange={(e) => setIdentity((s) => ({ ...s, secondaryPhone: e.target.value }))} />
          </Labeled>
          <Labeled label="Email">
            <input className="ui-input" type="email" value={identity.email} onChange={(e) => setIdentity((s) => ({ ...s, email: e.target.value }))} />
          </Labeled>
          <Labeled label="Address">
            <input className="ui-input" value={identity.address} onChange={(e) => setIdentity((s) => ({ ...s, address: e.target.value }))} />
          </Labeled>
          <div className="sm:col-span-2">
            <Labeled label="Notes">
              <textarea className="ui-input min-h-[80px]" value={identity.notes} onChange={(e) => setIdentity((s) => ({ ...s, notes: e.target.value }))} />
            </Labeled>
          </div>
          <div>
            <Button type="submit">Save profile</Button>
          </div>
        </form>
      )}

      {tab === "orders" && (
        <div className="space-y-2">
          {!(customer.orders || []).length && (
            <EmptyState title="No orders yet" body="Start a new order for this customer." />
          )}
          {(customer.orders || []).map((o) => (
            <Link
              key={o._id}
              to={`/orders/${encodeURIComponent(o.orderId)}`}
              className="ui-card flex items-center justify-between gap-3 p-4"
            >
              <div>
                <p className="font-mono text-xs font-semibold text-ink">{o.orderId}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {(o.items || []).map((it) => it.clothingType).join(" · ") || "No garments"}
                </p>
              </div>
              <span className="text-xs capitalize text-ink-muted">{o.productionStatus}</span>
            </Link>
          ))}
        </div>
      )}

      {tab === "garments" && (
        <div className="space-y-3">
          {!garments.length && (
            <EmptyState title="No previous garments" body="Create an order to start this customer’s history." />
          )}
          {garments.map((g) => (
            <div key={g.key} className="ui-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                {g.item.images?.[0]?.imageUrl ? (
                  <img src={imageUrlFromPath(g.item.images[0].imageUrl)} alt="" className="h-12 w-12 rounded-control object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-control bg-canvas text-xs text-ink-faint">
                    {g.clothingType.slice(0, 2)}
                  </div>
                )}
                <div>
                  <p className="font-medium text-ink">{g.clothingType}</p>
                  <p className="text-xs text-ink-muted">
                    {g.orderId} · {formatDate(g.createdAt)}
                    {g.fabric ? ` · ${g.fabric}` : ""}
                    {g.color ? ` · ${g.color}` : ""}
                  </p>
                </div>
              </div>
              <Link to={`/orders/new?customerId=${customer._id}&reuseItem=${g.item._id || ""}`}>
                <Button size="sm" variant="secondary">
                  Use for new order
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}

      {tab === "payments" && (
        <div className="ui-card overflow-hidden">
          <div className="grid grid-cols-3 gap-3 border-b border-line p-4 text-sm">
            <div>
              <p className="ui-label">Agreed</p>
              <p className="tabular font-semibold">{formatMoney(agreed)}</p>
            </div>
            <div>
              <p className="ui-label">Deposits</p>
              <p className="tabular font-semibold">{formatMoney(paid)}</p>
            </div>
            <div>
              <p className="ui-label">Balance</p>
              <p className="tabular font-semibold">{formatMoney(Math.max(0, agreed - paid))}</p>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {(customer.orders || []).map((o) => (
              <li key={o._id} className="flex items-center justify-between px-4 py-3 text-sm">
                <Link
                  to={`/orders/${encodeURIComponent(o.orderId)}`}
                  className="font-mono font-medium text-accent hover:underline"
                >
                  {o.orderId}
                </Link>
                <span className="tabular text-ink-muted">
                  {formatMoney(o.depositPaid)} / {formatMoney(o.totalAgreedPrice)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "measures" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <form onSubmit={onAddMeasurement} className="ui-card space-y-4 p-5">
            <h2 className="text-sm font-semibold">New measurement profile</h2>
            <select className="ui-input" value={category} onChange={(e) => setCategory(e.target.value as Cat)}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="child">Child</option>
              <option value="baby">Baby</option>
            </select>
            {MEASUREMENT_SCHEMAS[category].map((group) => (
              <div key={group.id}>
                <p className="ui-label mb-2">{group.label}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.fields.map((f) => (
                    <label key={f.key} className="block text-xs text-ink-muted">
                      {f.label} ({f.unit})
                      <input
                        className="ui-input"
                        inputMode="decimal"
                        value={values[f.key] || ""}
                        onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <input
              className="ui-input"
              placeholder="Notes"
              value={measureNotes}
              onChange={(e) => setMeasureNotes(e.target.value)}
            />
            <Button type="submit">Save measurements</Button>
          </form>
          <div className="space-y-3">
            {(customer.measurements || []).map((m: Measurement) => (
              <div key={m._id} className="ui-card p-4 text-sm">
                <div className="flex items-center justify-between">
                  <Badge tone="neutral">{m.category || "unspecified"}</Badge>
                  <span className="text-xs text-ink-muted">{formatDate(m.recordedAt)}</span>
                </div>
                <p className="mt-2 text-ink-muted">
                  {[
                    m.chest && `chest ${m.chest}`,
                    m.waist && `waist ${m.waist}`,
                    m.hip && `hip ${m.hip}`,
                    m.shoulder && `shoulder ${m.shoulder}`,
                    m.sleeveLength && `sleeve ${m.sleeveLength}`
                  ]
                    .filter(Boolean)
                    .join(" · ") || "No numeric fields"}
                </p>
                {m.notes && <p className="mt-1 text-xs">{m.notes}</p>}
              </div>
            ))}
            {!(customer.measurements || []).length && (
              <EmptyState
                title="No measurements yet"
                body="Save a category-specific profile for faster future orders."
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="ui-label">{label}</label>
      {children}
    </div>
  );
}
