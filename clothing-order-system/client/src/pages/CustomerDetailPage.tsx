import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError, imageUrlFromPath } from "@/lib/api";
import type { Customer, Measurement } from "@/lib/types";
import {
  MEASUREMENT_SCHEMAS,
  itemGenderToCategory,
  type MeasurementCategory as Cat
} from "@/lib/measurementSchema";
import { formatDate, formatMoney, shortOrderId } from "@/lib/format";
import { PageHeader, ErrorState, EmptyState, Badge } from "@/components/ui/PageHeader";
import { Tabs } from "@/components/ui/FilterChips";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/context/ToastContext";

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { push } = useToast();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"profile" | "orders" | "garments" | "measures" | "payments">("profile");
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

  function reuseMeasurement(m: Measurement) {
    const cat = (["male", "female", "child", "baby"].includes(m.category || "")
      ? m.category
      : "male") as Cat;
    setCategory(cat);
    const next: Record<string, string> = {};
    for (const group of MEASUREMENT_SCHEMAS[cat]) {
      for (const f of group.fields) {
        if (f.store === "column" && f.column) {
          const val = m[f.column];
          if (val != null && val !== "") next[f.key] = String(val);
        } else if (m.fields?.[f.key] != null && m.fields[f.key] !== "") {
          next[f.key] = String(m.fields[f.key]);
        }
      }
    }
    setValues(next);
    setMeasureNotes(m.notes || "");
    setTab("measures");
    push("Copied into the form. Save to keep a new profile.", "ok");
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

      <Tabs
        options={[
          { id: "profile", label: "Overview" },
          { id: "orders", label: "Orders" },
          { id: "garments", label: "Garments" },
          { id: "measures", label: "Measurements" },
          { id: "payments", label: "Payments" }
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "profile" && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="border border-line bg-surface px-4 py-3">
              <p className="ui-label">Outstanding</p>
              <p className="mt-1 text-xl font-semibold tabular">{formatMoney(Math.max(0, agreed - paid))}</p>
            </div>
            <div className="border border-line bg-surface px-4 py-3">
              <p className="ui-label">Orders</p>
              <p className="mt-1 text-xl font-semibold tabular">{(customer.orders || []).length}</p>
            </div>
            <div className="border border-line bg-surface px-4 py-3">
              <p className="ui-label">Garments</p>
              <p className="mt-1 text-xl font-semibold tabular">{garments.length}</p>
            </div>
          </div>
          <form onSubmit={saveIdentity} className="grid gap-3 border border-line bg-surface p-5 sm:grid-cols-2">
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
          {(customer.orders || []).length > 0 && (
            <div className="overflow-hidden border border-line">
              <div className="border-b border-line px-4 py-2.5">
                <p className="text-sm font-semibold text-ink">Recent orders</p>
              </div>
              <table className="ui-table w-full text-sm">
                <thead className="border-b border-line bg-canvas/70">
                  <tr>
                    <th>Order</th>
                    <th>Status</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {(customer.orders || []).slice(0, 5).map((o) => (
                    <tr key={o._id} className="border-t border-line">
                      <td>
                        <Link to={`/orders/${encodeURIComponent(o.orderId)}`} className="font-mono text-xs font-semibold text-accent">
                          {shortOrderId(o.orderId)}
                        </Link>
                      </td>
                      <td className="capitalize text-xs text-ink-muted">{o.productionStatus}</td>
                      <td className="tabular text-xs text-ink-muted">
                        {formatMoney(Math.max(0, (o.totalAgreedPrice || 0) - (o.depositPaid || 0)))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="overflow-hidden border border-line">
          {!(customer.orders || []).length ? (
            <div className="p-6">
              <EmptyState title="No orders yet" body="Start a new order for this customer." />
            </div>
          ) : (
            <table className="ui-table w-full text-sm">
              <thead className="border-b border-line bg-canvas/70">
                <tr>
                  <th>Order</th>
                  <th>Garments</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {(customer.orders || []).map((o) => (
                  <tr key={o._id} className="border-t border-line">
                    <td>
                      <Link
                        to={`/orders/${encodeURIComponent(o.orderId)}`}
                        className="font-mono text-xs font-semibold text-accent hover:underline"
                      >
                        {shortOrderId(o.orderId)}
                      </Link>
                    </td>
                    <td className="text-xs text-ink-muted">
                      {(o.items || []).map((it) => it.clothingType).join(" · ") || "—"}
                    </td>
                    <td className="text-xs text-ink-muted">{formatDate(o.createdAt)}</td>
                    <td>
                      <Badge tone="neutral">{o.productionStatus}</Badge>
                    </td>
                    <td className="tabular text-xs text-ink-muted">
                      {formatMoney(o.depositPaid)} / {formatMoney(o.totalAgreedPrice)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
                    {shortOrderId(g.orderId)} · {formatDate(g.createdAt)}
                    {g.fabric ? ` · ${g.fabric}` : ""}
                    {g.color ? ` · ${g.color}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to={`/orders/new?customerId=${customer._id}&reuseItem=${g.item._id || ""}`}>
                  <Button size="sm">Use garment</Button>
                </Link>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const cat = itemGenderToCategory(g.item.measurements?.gender, g.item.size);
                    setCategory(cat);
                    setValues({
                      chest: g.item.measurements?.chest || "",
                      bust: g.item.measurements?.breast || g.item.measurements?.chest || "",
                      waist: g.item.measurements?.waist || "",
                      hip: g.item.measurements?.vest || "",
                      shoulder: g.item.measurements?.shoulder || "",
                      sleeveLength: g.item.measurements?.arm || "",
                      height: g.item.measurements?.height || ""
                    });
                    setTab("measures");
                    push("Copied measurements into the form. Save to keep a profile.", "ok");
                  }}
                >
                  Copy measurements
                </Button>
                <Link to={`/orders/new?customerId=${customer._id}&reuseItem=${g.item._id || ""}`}>
                  <Button size="sm" variant="ghost">
                    Create similar
                  </Button>
                </Link>
                {g.item._id && (
                  <Link to={`/garments/${encodeURIComponent(g.item._id)}`}>
                    <Button size="sm" variant="ghost">
                      Open
                    </Button>
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "payments" && (
        <div className="overflow-hidden border border-line bg-surface">
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
                  {shortOrderId(o.orderId)}
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
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="neutral">{m.category || "unspecified"}</Badge>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">{formatDate(m.recordedAt)}</span>
                    <Button type="button" size="sm" variant="ghost" onClick={() => reuseMeasurement(m)}>
                      Reuse
                    </Button>
                  </div>
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
