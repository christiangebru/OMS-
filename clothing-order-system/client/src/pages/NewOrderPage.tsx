import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiJson, ApiError, balanceRemaining } from "@/lib/api";
import type {
  ClothingTypeConfig,
  Customer,
  HandType,
  NeckType,
  Order,
  OrderItem,
  OrderItemImage,
  OrderPriority,
  SizeCategory
} from "@/lib/types";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ClothingTypePicker } from "@/components/ClothingTypePicker";
import { ImageGalleryUploader } from "@/components/ImageGalleryUploader";
import { PageHeader, ErrorState, EmptyState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import {
  MEASUREMENT_SCHEMAS,
  itemGenderToCategory,
  valuesToCustomerMeasurementBody,
  valuesToItemMeasurements,
  type MeasurementCategory
} from "@/lib/measurementSchema";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";

type Phase = "customer" | "garments" | "edit" | "schedule" | "review";
type EditStep = 0 | 1 | 2 | 3 | 4 | 5;

type Draft = {
  key: string;
  clothingType: string;
  clothingCode: string;
  fabricType: string;
  color: string;
  notes: string;
  neckType: NeckType;
  handType: HandType;
  size: SizeCategory;
  images: OrderItemImage[];
  productionDays: number;
  unitPrice: number;
  difficultyLevel: number;
  category: MeasurementCategory;
  measureValues: Record<string, string>;
  copiedFromPrevious?: boolean;
};

const EDIT_LABELS = ["Type", "Reuse", "Fit", "Specs", "Images", "Price"];

function newKey() {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyDraft(): Draft {
  return {
    key: newKey(),
    clothingType: "",
    clothingCode: "",
    fabricType: "",
    color: "",
    notes: "",
    neckType: "oval",
    handType: "normal",
    size: "adult",
    images: [],
    productionDays: 3,
    unitPrice: 0,
    difficultyLevel: 3,
    category: "male",
    measureValues: {}
  };
}

function draftFromItem(src: OrderItem, category?: MeasurementCategory): Draft {
  const cat = category || itemGenderToCategory(src.measurements?.gender, src.size);
  return {
    key: newKey(),
    clothingType: src.clothingType,
    clothingCode: src.clothingCode,
    fabricType: src.fabricType,
    color: src.color,
    notes: src.notes,
    neckType: src.neckType,
    handType: src.handType,
    size: src.size,
    images: [],
    productionDays: src.productionDays || 3,
    unitPrice: src.unitPrice || 0,
    difficultyLevel: src.difficultyLevel || 3,
    category: cat,
    measureValues: {
      chest: src.measurements?.chest || "",
      bust: src.measurements?.breast || src.measurements?.chest || "",
      waist: src.measurements?.waist || "",
      hip: src.measurements?.vest || "",
      shoulder: src.measurements?.shoulder || "",
      sleeveLength: src.measurements?.arm || "",
      height: src.measurements?.height || "",
      dressLength: src.measurements?.height || ""
    }
  };
}

function toPayloadItem(d: Draft) {
  const measurements = valuesToItemMeasurements(d.category, d.measureValues);
  const size = d.category === "baby" ? "baby" : d.category === "child" ? "kids" : d.size || "adult";
  return {
    clothingCode: d.clothingCode || d.clothingType.slice(0, 8).toUpperCase(),
    clothingType: d.clothingType,
    fabricType: d.fabricType || "unspecified",
    color: d.color || "unspecified",
    quantity: 1,
    notes: d.notes,
    neckType: d.neckType,
    handType: d.handType,
    size,
    measurements,
    productionDays: d.productionDays,
    unitPrice: Number(d.unitPrice) || 0,
    difficultyLevel: d.difficultyLevel,
    images: (d.images || []).map((img) => ({
      imageUrl: img.imageUrl,
      caption: img.caption || "",
      category: img.category || "other"
    }))
  };
}

export function NewOrderPage() {
  const navigate = useNavigate();
  const { push } = useToast();
  const [params] = useSearchParams();
  const [phase, setPhase] = useState<Phase>("customer");
  const [editStep, setEditStep] = useState<EditStep>(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [types, setTypes] = useState<ClothingTypeConfig[]>([]);
  const [customerId, setCustomerId] = useState<string | null>(params.get("customerId"));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [reuseMode, setReuseMode] = useState<"scratch" | "previous">("scratch");
  const [deposit, setDeposit] = useState(0);
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");

  useEffect(() => {
    apiJson<ClothingTypeConfig[]>("/api/clothing-types").then(setTypes).catch(() => {});
  }, []);

  useEffect(() => {
    const cid = params.get("customerId");
    if (!cid) return;
    apiJson<Customer>(`/api/customers/${cid}`)
      .then((c) => {
        setCustomer(c);
        setCustomerId(c._id);
        setCustomerName(c.name);
        setCustomerPhone(c.phone);
        const reuseId = params.get("reuseItem");
        if (reuseId) {
          const found = c.orders?.flatMap((o) => o.items || []).find((it) => it._id === reuseId);
          if (found) {
            setDrafts([{ ...draftFromItem(found), copiedFromPrevious: true }]);
            setPhase("garments");
          }
        }
      })
      .catch(() => {});
  }, [params]);

  const previousItems = useMemo(
    () =>
      (customer?.orders || []).flatMap((o) =>
        (o.items || []).map((it) => ({ orderId: o.orderId, createdAt: o.createdAt, item: it }))
      ),
    [customer]
  );

  const agreed = drafts.reduce((s, d) => s + (Number(d.unitPrice) || 0), 0);
  const balance = balanceRemaining(agreed, deposit);

  function beginAdd() {
    setEditing(emptyDraft());
    setEditStep(0);
    setReuseMode("scratch");
    setPhase("edit");
  }

  function beginEdit(d: Draft) {
    setEditing({ ...d, measureValues: { ...d.measureValues }, images: [...(d.images || [])] });
    setEditStep(0);
    setReuseMode("scratch");
    setPhase("edit");
  }

  function applyPreviousToEdit(src: OrderItem) {
    if (!editing) return;
    const next = draftFromItem(src);
    setEditing({ ...next, key: editing.key, copiedFromPrevious: true });
    setReuseMode("previous");
    setEditStep(2);
  }

  function saveEditing() {
    if (!editing || !editing.clothingType.trim()) return;
    setDrafts((list) => {
      const idx = list.findIndex((d) => d.key === editing.key);
      if (idx === -1) return [...list, editing];
      const copy = [...list];
      copy[idx] = editing;
      return copy;
    });
    setEditing(null);
    setPhase("garments");
  }

  function removeDraft(key: string) {
    setDrafts((list) => list.filter((d) => d.key !== key));
  }

  function canEditNext() {
    if (!editing) return false;
    if (editStep === 0) return Boolean(editing.clothingType.trim());
    return true;
  }

  async function create() {
    if (!drafts.length || !due) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await apiJson<Order>("/api/orders", {
        method: "POST",
        body: JSON.stringify({
          customerId: customerId || undefined,
          customerName: customerId ? undefined : customerName,
          customerPhone: customerId ? undefined : customerPhone,
          requiredCompletionDate: new Date(due).toISOString(),
          priority,
          totalAgreedPrice: Number(agreed),
          depositPaid: Number(deposit),
          items: drafts.map(toPayloadItem)
        })
      });
      const cid = created.customer?._id || customerId;
      const first = drafts[0];
      if (cid && first && Object.values(first.measureValues).some(Boolean)) {
        try {
          await apiJson(`/api/customers/${cid}/measurements`, {
            method: "POST",
            body: JSON.stringify(valuesToCustomerMeasurementBody(first.category, first.measureValues))
          });
        } catch {
          /* best-effort */
        }
      }
      push(`Order created · ${created.items.length} garment${created.items.length === 1 ? "" : "s"}`, "ok");
      navigate(`/orders/${encodeURIComponent(created.orderId)}`, { replace: true });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create order");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="New order"
        description="Customer first. Add every garment, then set due date and deposit."
      />

      <ol className="flex flex-wrap gap-1.5">
        {[
          { id: "customer", label: "Customer" },
          { id: "garments", label: "Garments" },
          { id: "schedule", label: "Schedule" },
          { id: "review", label: "Review" }
        ].map((s, i) => {
          const active = phase === s.id || (s.id === "garments" && phase === "edit");
          const done =
            (s.id === "customer" && phase !== "customer") ||
            (s.id === "garments" && (phase === "schedule" || phase === "review")) ||
            (s.id === "schedule" && phase === "review");
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  if (s.id === "customer") setPhase("customer");
                  if (s.id === "garments" && (customerId || customerName)) setPhase("garments");
                  if (s.id === "schedule" && drafts.length) setPhase("schedule");
                  if (s.id === "review" && drafts.length && due) setPhase("review");
                }}
                className={clsx(
                  "rounded-control px-2.5 py-1 text-[11px] font-medium",
                  active ? "bg-accent text-white" : done ? "bg-accent-soft text-accent" : "bg-canvas text-ink-faint"
                )}
              >
                {i + 1}. {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      {err && <ErrorState message={err} />}

      <div className="ui-card p-5">
        {phase === "customer" && (
          <CustomerPicker
            customerId={customerId}
            customerName={customerName}
            customerPhone={customerPhone}
            onSelect={(c, latest) => {
              setCustomer(c);
              setCustomerId(c._id);
              setCustomerName(c.name);
              setCustomerPhone(c.phone);
              if (latest && !drafts.length) {
                /* preload category onto the next garment add */
              }
            }}
            onClear={() => {
              setCustomer(null);
              setCustomerId(null);
              setCustomerName("");
              setCustomerPhone("");
            }}
            onNamePhoneChange={(n, p) => {
              setCustomerName(n);
              setCustomerPhone(p);
            }}
          />
        )}

        {phase === "garments" && (
          <div className="space-y-4">
            {drafts.length === 0 ? (
              <EmptyState
                title="No garments yet"
                body="Add the first piece. You can add a suit, shirt, and trousers on the same order."
                action={
                  <Button type="button" onClick={beginAdd}>
                    Add garment
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-2">
                {drafts.map((d, i) => (
                  <li
                    key={d.key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">
                        {i + 1}. {d.clothingType || "Untitled garment"}
                        {d.copiedFromPrevious ? (
                          <span className="ml-2 text-[11px] font-medium text-accent">Copied · still editable</span>
                        ) : null}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {d.fabricType || "Fabric TBD"} · {d.color || "Color TBD"} · {formatMoney(d.unitPrice)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => beginEdit(d)}>
                        Edit
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => removeDraft(d.key)}>
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {drafts.length > 0 && (
              <Button type="button" variant="secondary" onClick={beginAdd}>
                Add another garment
              </Button>
            )}
          </div>
        )}

        {phase === "edit" && editing && (
          <div className="space-y-4">
            <ol className="flex flex-wrap gap-1">
              {EDIT_LABELS.map((label, i) => (
                <li key={label}>
                  <span
                    className={clsx(
                      "rounded-control px-2 py-0.5 text-[10px] font-medium",
                      i === editStep ? "bg-accent text-white" : i < editStep ? "bg-accent-soft text-accent" : "bg-canvas text-ink-faint"
                    )}
                  >
                    {label}
                  </span>
                </li>
              ))}
            </ol>

            {editStep === 0 && (
              <ClothingTypePicker
                types={types}
                value={editing.clothingType}
                onChange={(t) =>
                  setEditing((d) =>
                    d
                      ? {
                          ...d,
                          clothingType: t.label,
                          clothingCode: d.clothingCode || t.key.toUpperCase()
                        }
                      : d
                  )
                }
              />
            )}

            {editStep === 1 && (
              <div className="space-y-3">
                {editing.copiedFromPrevious && (
                  <p className="rounded-control bg-accent-soft px-3 py-2 text-xs text-accent">
                    Copied from a previous garment. Change anything that is different this time.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={reuseMode === "scratch" ? "primary" : "secondary"}
                    onClick={() => setReuseMode("scratch")}
                  >
                    Start from scratch
                  </Button>
                  <Button
                    type="button"
                    variant={reuseMode === "previous" ? "primary" : "secondary"}
                    onClick={() => setReuseMode("previous")}
                    disabled={!previousItems.length}
                  >
                    Use previous garment
                  </Button>
                </div>
                {reuseMode === "previous" && (
                  <ul className="space-y-2">
                    {previousItems.map((row) => (
                      <li key={row.item._id || `${row.orderId}-${row.item.clothingCode}`}>
                        <button
                          type="button"
                          className="w-full rounded-control border border-line px-3 py-2 text-left text-sm hover:bg-canvas"
                          onClick={() => applyPreviousToEdit(row.item)}
                        >
                          <span className="font-medium">{row.item.clothingType}</span>
                          <span className="block text-xs text-ink-muted">
                            {row.orderId} · {row.item.fabricType} · {row.item.color}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!previousItems.length && (
                  <p className="text-sm text-ink-muted">No previous garments for this customer.</p>
                )}
              </div>
            )}

            {editStep === 2 && (
              <div className="space-y-4">
                <select
                  className="ui-input"
                  value={editing.category}
                  onChange={(e) =>
                    setEditing((d) => (d ? { ...d, category: e.target.value as MeasurementCategory } : d))
                  }
                >
                  <option value="male">Adult male</option>
                  <option value="female">Adult female</option>
                  <option value="child">Child</option>
                  <option value="baby">Baby</option>
                </select>
                {MEASUREMENT_SCHEMAS[editing.category].map((group) => (
                  <div key={group.id}>
                    <p className="ui-label mb-2">{group.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.fields.map((f) => (
                        <label key={f.key} className="block text-xs text-ink-muted">
                          {f.label} ({f.unit})
                          <input
                            className="ui-input"
                            inputMode="decimal"
                            value={editing.measureValues[f.key] || ""}
                            onChange={(e) =>
                              setEditing((d) =>
                                d
                                  ? { ...d, measureValues: { ...d.measureValues, [f.key]: e.target.value } }
                                  : d
                              )
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {editStep === 3 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Fabric">
                  <input
                    className="ui-input"
                    value={editing.fabricType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, fabricType: e.target.value } : d))}
                  />
                </Labeled>
                <Labeled label="Color">
                  <input
                    className="ui-input"
                    value={editing.color}
                    onChange={(e) => setEditing((d) => (d ? { ...d, color: e.target.value } : d))}
                  />
                </Labeled>
                <Labeled label="Collar / neck">
                  <select
                    className="ui-input"
                    value={editing.neckType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, neckType: e.target.value as NeckType } : d))}
                  >
                    <option value="oval">Oval</option>
                    <option value="V-shape">V-shape</option>
                    <option value="square">Square</option>
                  </select>
                </Labeled>
                <Labeled label="Sleeve / hand">
                  <select
                    className="ui-input"
                    value={editing.handType}
                    onChange={(e) => setEditing((d) => (d ? { ...d, handType: e.target.value as HandType } : d))}
                  >
                    <option value="normal">Normal</option>
                    <option value="wide">Wide</option>
                  </select>
                </Labeled>
                <div className="sm:col-span-2">
                  <Labeled label="Special instructions">
                    <textarea
                      className="ui-input min-h-[72px]"
                      value={editing.notes}
                      onChange={(e) => setEditing((d) => (d ? { ...d, notes: e.target.value } : d))}
                    />
                  </Labeled>
                </div>
              </div>
            )}

            {editStep === 4 && (
              <ImageGalleryUploader
                images={editing.images || []}
                onChange={(images: OrderItemImage[]) => setEditing((d) => (d ? { ...d, images } : d))}
                onError={setErr}
              />
            )}

            {editStep === 5 && (
              <Labeled label="Agreed price for this garment">
                <input
                  className="ui-input tabular"
                  type="number"
                  min={0}
                  value={editing.unitPrice}
                  onChange={(e) => setEditing((d) => (d ? { ...d, unitPrice: Number(e.target.value) } : d))}
                />
              </Labeled>
            )}
          </div>
        )}

        {phase === "schedule" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="Due date">
              <input className="ui-input" type="date" required value={due} onChange={(e) => setDue(e.target.value)} />
            </Labeled>
            <Labeled label="Priority">
              <select className="ui-input" value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)}>
                <option value="NORMAL">Normal</option>
                <option value="RUSH">Rush</option>
                <option value="VIP">VIP</option>
              </select>
            </Labeled>
            <Labeled label="Deposit (whole order)">
              <input
                className="ui-input tabular"
                type="number"
                min={0}
                value={deposit}
                onChange={(e) => setDeposit(Number(e.target.value))}
              />
            </Labeled>
            <div>
              <p className="ui-label">Order total / balance</p>
              <p className="mt-2 text-xl font-semibold tabular">
                {formatMoney(agreed)} · {formatMoney(balance)} due
              </p>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="space-y-4 text-sm">
            <Row k="Customer" v={customerName || customer?.name || "—"} />
            <Row k="Due" v={`${due || "—"} · ${priority}`} />
            <Row k="Deposit / balance" v={`${formatMoney(deposit)} / ${formatMoney(balance)}`} />
            <ul className="divide-y divide-line rounded-lg border border-line">
              {drafts.map((d) => (
                <li key={d.key} className="flex justify-between gap-3 px-3 py-2">
                  <span>
                    {d.clothingType}
                    <span className="block text-xs text-ink-muted">
                      {d.fabricType || "—"} · {d.images.length} image{d.images.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="tabular font-medium">{formatMoney(d.unitPrice)}</span>
                </li>
              ))}
            </ul>
            <p className="text-right text-base font-semibold tabular">Total {formatMoney(agreed)}</p>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        {phase === "customer" && (
          <>
            <span />
            <Button
              type="button"
              disabled={!customerId && !(customerName.trim() && customerPhone.trim())}
              onClick={() => setPhase("garments")}
            >
              Continue
            </Button>
          </>
        )}
        {phase === "garments" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setPhase("customer")}>
              Back
            </Button>
            <Button type="button" disabled={!drafts.length} onClick={() => setPhase("schedule")}>
              Continue
            </Button>
          </>
        )}
        {phase === "edit" && (
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (editStep === 0) {
                  setEditing(null);
                  setPhase("garments");
                } else setEditStep((s) => (s - 1) as EditStep);
              }}
            >
              Back
            </Button>
            {editStep < 5 ? (
              <Button type="button" disabled={!canEditNext()} onClick={() => setEditStep((s) => (s + 1) as EditStep)}>
                Continue
              </Button>
            ) : (
              <Button type="button" onClick={saveEditing}>
                Save garment
              </Button>
            )}
          </>
        )}
        {phase === "schedule" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setPhase("garments")}>
              Back
            </Button>
            <Button type="button" disabled={!due} onClick={() => setPhase("review")}>
              Continue
            </Button>
          </>
        )}
        {phase === "review" && (
          <>
            <Button type="button" variant="secondary" onClick={() => setPhase("schedule")}>
              Back
            </Button>
            <Button type="button" disabled={busy || !drafts.length || !due} onClick={create}>
              {busy ? "Creating…" : `Create order · ${drafts.length} garment${drafts.length === 1 ? "" : "s"}`}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="ui-label">{label}</label>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
    </div>
  );
}
