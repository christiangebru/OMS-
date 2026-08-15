import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, ApiError, balanceRemaining, apiBaseUrl, authToken } from "@/lib/api";
import type {
  ClothingTypeConfig,
  Customer,
  HandType,
  Measurement,
  NeckType,
  Order,
  OrderItem,
  OrderPriority,
  ProductionStatus,
  SizeCategory
} from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ImageGalleryUploader } from "@/components/ImageGalleryUploader";
import { ClothingTypePicker } from "@/components/ClothingTypePicker";
import { ItemMeasurementFields } from "@/components/ItemMeasurementFields";
import { Button } from "@/components/ui/Button";
import { formatDate, formatMoney } from "@/lib/format";
import { BarcodeImage } from "@/components/BarcodeImage";

const NECK: NeckType[] = ["V-shape", "square", "oval"];
const HAND: HandType[] = ["wide", "normal"];
const SIZES: SizeCategory[] = ["adult", "kids", "baby"];
const STATUSES: ProductionStatus[] = [
  "pending",
  "cutting",
  "stitching",
  "finishing",
  "completed",
  "delivered"
];
const PRIORITIES: OrderPriority[] = ["NORMAL", "RUSH", "VIP"];

function emptyItem(): OrderItem {
  return {
    clothingCode: "",
    clothingType: "",
    fabricType: "",
    color: "",
    quantity: 1,
    notes: "",
    neckType: "V-shape",
    handType: "normal",
    size: "adult",
    images: [],
    productionDays: 3,
    unitPrice: 0,
    difficultyLevel: 3,
    measurements: {
      gender: "female",
      vest: "",
      height: "",
      breast: "",
      waist: "",
      shoulder: "",
      arm: "",
      chest: ""
    }
  };
}

function measurementToItemSnapshot(m: Measurement | null | undefined): OrderItem["measurements"] {
  if (!m) {
    return {
      gender: "female",
      vest: "",
      height: "",
      breast: "",
      waist: "",
      shoulder: "",
      arm: "",
      chest: ""
    };
  }
  return {
    gender: "female",
    vest: "",
    height: "",
    breast: m.chest != null ? String(m.chest) : "",
    waist: m.waist != null ? String(m.waist) : "",
    shoulder: m.shoulder != null ? String(m.shoulder) : "",
    arm: m.sleeveLength != null ? String(m.sleeveLength) : "",
    chest: m.chest != null ? String(m.chest) : ""
  };
}

export function OrderEditPage() {
  const { orderId } = useParams<{ orderId?: string }>();
  const isCreate = !orderId;
  const navigate = useNavigate();
  const { user } = useAuth();

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [groupCode, setGroupCode] = useState("");
  const [requiredDate, setRequiredDate] = useState("");
  const [productionStatus, setProductionStatus] = useState<ProductionStatus>("pending");
  const [priority, setPriority] = useState<OrderPriority>("NORMAL");
  const [totalAgreedPrice, setTotalAgreedPrice] = useState(0);
  const [depositPaid, setDepositPaid] = useState(0);
  const [barcodeValue, setBarcodeValue] = useState("");
  const [items, setItems] = useState<OrderItem[]>([emptyItem()]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isCreate);
  const [clothingTypes, setClothingTypes] = useState<ClothingTypeConfig[]>([]);
  const [previousOrders, setPreviousOrders] = useState<NonNullable<Customer["orders"]>>([]);

  useEffect(() => {
    let cancelled = false;
    apiJson<ClothingTypeConfig[]>("/api/clothing-types")
      .then((data) => {
        if (!cancelled) setClothingTypes(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isCreate) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId!)}`);
        if (cancelled) return;
        setCustomerId(o.customerId || o.customer?._id || null);
        setCustomerName(o.customerName || o.customer?.name || "");
        setCustomerPhone(o.customerPhone || o.customer?.phone || "");
        setGroupCode(o.groupCode || "");
        setRequiredDate(o.requiredCompletionDate?.slice(0, 10) || "");
        setProductionStatus(o.productionStatus);
        setPriority(o.priority || "NORMAL");
        setTotalAgreedPrice(o.totalAgreedPrice ?? o.totalRevenue ?? 0);
        setDepositPaid(o.depositPaid ?? 0);
        setBarcodeValue(o.barcodeValue || "");
        setItems(
          o.items.length
            ? o.items.map((it) => ({
                ...it,
                notes: it.notes || "",
                images: it.images?.length
                  ? it.images
                  : it.imagePath
                    ? [{ imageUrl: it.imagePath }]
                    : [],
                productionDays: it.productionDays || 3,
                unitPrice: it.unitPrice ?? 0,
                difficultyLevel: it.difficultyLevel ?? 3
              }))
            : [emptyItem()]
        );
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load order");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreate, orderId]);

  function updateItem(index: number, patch: Partial<OrderItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function onCustomerSelect(c: Customer, latest?: Measurement | null) {
    setCustomerId(c._id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    setPreviousOrders(c.orders || []);
    if (latest) {
      const snap = measurementToItemSnapshot(latest);
      setItems((prev) =>
        prev.map((it) => ({
          ...it,
          measurements: { ...snap, gender: it.measurements?.gender || snap!.gender }
        }))
      );
    }
  }

  function copyItemTemplate(src: OrderItem): OrderItem {
    return {
      ...emptyItem(),
      clothingCode: src.clothingCode,
      clothingType: src.clothingType,
      fabricType: src.fabricType,
      color: src.color,
      quantity: 1,
      notes: src.notes,
      neckType: src.neckType,
      handType: src.handType,
      size: src.size,
      measurements: src.measurements ? { ...src.measurements } : emptyItem().measurements,
      productionDays: src.productionDays,
      unitPrice: src.unitPrice,
      difficultyLevel: src.difficultyLevel,
      images: []
    };
  }

  function reuseLastOrder() {
    const last = previousOrders[0];
    if (!last?.items?.length) return;
    setItems(last.items.map(copyItemTemplate));
    if (last.totalAgreedPrice) setTotalAgreedPrice(last.totalAgreedPrice);
    setMsg(`Copied specifications from ${last.orderId}. Adjust anything that changed.`);
  }

  function copySimilarItem(index: number) {
    const src = items[index];
    setItems((prev) => [...prev, copyItemTemplate(src)]);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setErr(null);
    setMsg(null);
    setSaving(true);
    const payload = {
      customerId: customerId || undefined,
      customerName: customerId ? undefined : customerName,
      customerPhone: customerId ? undefined : customerPhone,
      groupCode,
      requiredCompletionDate: new Date(requiredDate).toISOString(),
      productionStatus,
      priority,
      totalAgreedPrice: Number(totalAgreedPrice),
      depositPaid: Number(depositPaid),
      items: items.map((it) => ({
        clothingCode: it.clothingCode,
        clothingType: it.clothingType,
        fabricType: it.fabricType,
        color: it.color,
        quantity: Number(it.quantity),
        notes: it.notes,
        neckType: it.neckType,
        handType: it.handType,
        size: it.size,
        measurements: it.measurements,
        productionDays: Number(it.productionDays),
        unitPrice: Number(it.unitPrice),
        difficultyLevel: Number(it.difficultyLevel) || 3,
        images: (it.images || []).map((img) => ({
          imageUrl: img.imageUrl,
          caption: img.caption || ""
        }))
      }))
    };

    try {
      if (isCreate) {
        const created = await apiJson<Order>("/api/orders", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        setMsg("Order created.");
        navigate(`/orders/${encodeURIComponent(created.orderId)}`, { replace: true });
      } else {
        const updated = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId!)}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        setMsg("Order updated.");
        setBarcodeValue(updated.barcodeValue || "");
        setItems(
          updated.items.map((it) => ({
            ...it,
            images: it.images || [],
            difficultyLevel: it.difficultyLevel ?? 3
          }))
        );
      }
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!orderId || !user || user.role !== "admin") return;
    if (!confirm("Permanently delete this order?")) return;
    try {
      await apiJson(`/api/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
      navigate("/orders");
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Delete failed");
    }
  }

  function openPdf(path: string) {
    const token = authToken();
    const url = `${apiBaseUrl()}${path}`;
    // Open with token via fetch blob for auth
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.blob())
      .then((blob) => {
        const obj = URL.createObjectURL(blob);
        window.open(obj, "_blank");
      })
      .catch(() => setErr("Could not open PDF label"));
  }

  const balance = balanceRemaining(totalAgreedPrice, depositPaid);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-pulse rounded-full bg-line" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {isCreate ? "New order" : `Edit ${orderId}`}
          </h1>
          <p className="text-sm text-ink-muted">
            Commercial fields and garment specifications. Production lives on each garment.
          </p>
          {!isCreate && barcodeValue && (
            <p className="mt-1 font-mono text-xs text-ink-muted">Barcode: {barcodeValue}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCreate && (
            <>
              <Link
                to={`/orders/${encodeURIComponent(orderId!)}/print-labels?mode=order`}
                className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
              >
                Print order label
              </Link>
              <Link
                to={`/orders/${encodeURIComponent(orderId!)}/print-labels`}
                className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
              >
                Print all item labels
              </Link>
              <button
                type="button"
                onClick={() =>
                  openPdf(`/api/orders/${encodeURIComponent(orderId!)}/barcode-labels/batch`)
                }
                className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
              >
                PDF batch
              </button>
            </>
          )}
              <Link to={`/orders/${encodeURIComponent(orderId!)}`} className="text-sm font-semibold text-accent hover:underline">
                ← Order
              </Link>
        </div>
      </div>

      {!isCreate && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="ui-card px-4 py-3">
            <p className="ui-label">Customer</p>
            {customerId ? (
              <Link to={`/customers/${customerId}`} className="mt-1 block font-semibold text-ink hover:text-accent">
                {customerName || "—"}
              </Link>
            ) : (
              <p className="mt-1 font-semibold text-ink">{customerName || "—"}</p>
            )}
            <p className="text-xs text-ink-muted">{customerPhone}</p>
          </div>
          <div className="ui-card px-4 py-3">
            <p className="ui-label">Garments</p>
            <p className="mt-1 text-xl font-semibold tabular">{items.length}</p>
            <p className="truncate text-xs text-ink-muted">{items.map((i) => i.clothingType).join(" · ")}</p>
          </div>
          <div className="ui-card px-4 py-3">
            <p className="ui-label">Due</p>
            <p className="mt-1 font-semibold text-ink">{formatDate(requiredDate)}</p>
            <p className="text-xs capitalize text-ink-muted">{priority.toLowerCase()} · {productionStatus}</p>
          </div>
          <div className="ui-card px-4 py-3">
            <p className="ui-label">Balance</p>
            <p className="mt-1 text-xl font-semibold tabular">{formatMoney(balance)}</p>
            <p className="text-xs text-ink-muted">
              {formatMoney(depositPaid)} of {formatMoney(totalAgreedPrice)} paid
            </p>
          </div>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="ui-card space-y-8 p-4 sm:p-6"
      >
        <section className="relative grid gap-4 sm:grid-cols-2">
          <CustomerPicker
            customerId={customerId}
            customerName={customerName}
            customerPhone={customerPhone}
            onSelect={onCustomerSelect}
            onClear={() => {
              setCustomerId(null);
              setCustomerName("");
              setCustomerPhone("");
            }}
            onNamePhoneChange={(n, p) => {
              setCustomerName(n);
              setCustomerPhone(p);
            }}
          />
          {isCreate && previousOrders[0]?.items?.length ? (
            <div className="sm:col-span-2 rounded-lg border border-line bg-accent-soft/60 px-3 py-3">
              <p className="text-sm text-ink">
                Last order {previousOrders[0].orderId}:{" "}
                {previousOrders[0].items.map((i) => i.clothingType).join(", ")}
              </p>
              <Button type="button" size="sm" className="mt-2" onClick={reuseLastOrder}>
                Use previous order
              </Button>
            </div>
          ) : null}
          <div>
            <label className="ui-label" htmlFor="group">
              Group code (optional)
            </label>
            <input
              id="group"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              className="ui-input"
              placeholder="e.g. WEDDING-2026"
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="due">
              Required completion date
            </label>
            <input
              id="due"
              type="date"
              required
              value={requiredDate}
              onChange={(e) => setRequiredDate(e.target.value)}
              className="ui-input"
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="status">
              Production status
            </label>
            <select
              id="status"
              value={productionStatus}
              onChange={(e) => setProductionStatus(e.target.value as ProductionStatus)}
              className="ui-input"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as OrderPriority)}
              className="ui-input"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="ui-label" htmlFor="agreed">
              Total agreed price
            </label>
            <input
              id="agreed"
              type="number"
              min={0}
              step="0.01"
              value={totalAgreedPrice}
              onChange={(e) => setTotalAgreedPrice(Number(e.target.value))}
              className="ui-input"
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="deposit">
              Deposit paid
            </label>
            <input
              id="deposit"
              type="number"
              min={0}
              step="0.01"
              value={depositPaid}
              onChange={(e) => setDepositPaid(Number(e.target.value))}
              className="ui-input"
            />
          </div>
          <div>
            <p className="ui-label">Balance remaining</p>
            <p className="mt-2 text-lg font-bold text-ink">{balance.toFixed(2)}</p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Clothing items</h2>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
              className="rounded-control border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-canvas"
            >
              Add item
            </button>
          </div>

          {items.map((it, index) => (
            <div
              key={it._id || index}
              className="ui-card p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-muted">
                  Item {index + 1}
                  {it.barcodeValue ? (
                    <span className="ml-2 inline-flex items-center gap-2 font-mono font-normal normal-case text-ink-faint">
                      {it.barcodeValue}
                      <Link
                        to={`/scan?barcode=${encodeURIComponent(it.barcodeValue)}`}
                        className="font-sans font-semibold text-accent hover:underline"
                      >
                        Scan
                      </Link>
                    </span>
                  ) : null}
                </span>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    className="text-xs font-semibold text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => copySimilarItem(index)}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Create similar item
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <ClothingTypePicker
                    types={clothingTypes}
                    value={it.clothingType}
                    onChange={(t) =>
                      updateItem(index, {
                        clothingType: "label" in t ? t.label : t.label,
                        clothingCode: it.clothingCode || ("key" in t ? t.key.toUpperCase() : it.clothingCode)
                      })
                    }
                  />
                </div>
                <Field label="Internal code" small>
                  <input
                    required
                    value={it.clothingCode}
                    onChange={(e) => updateItem(index, { clothingCode: e.target.value })}
                    className="ui-input"
                  />
                </Field>
                <Field label="Fabric type" small>
                  <input
                    required
                    value={it.fabricType}
                    onChange={(e) => updateItem(index, { fabricType: e.target.value })}
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Color" small>
                  <input
                    required
                    value={it.color}
                    onChange={(e) => updateItem(index, { color: e.target.value })}
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Quantity" small>
                  <input
                    type="number"
                    min={1}
                    required
                    value={it.quantity}
                    onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Unit price" small>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.unitPrice}
                    onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) })}
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Production days" small>
                  <input
                    type="number"
                    min={1}
                    value={it.productionDays}
                    onChange={(e) => updateItem(index, { productionDays: Number(e.target.value) })}
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Difficulty (1–5)" small>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={it.difficultyLevel ?? 3}
                    onChange={(e) =>
                      updateItem(index, { difficultyLevel: Number(e.target.value) })
                    }
                    className="ui-input mt-0"
                  />
                </Field>
                <Field label="Neck type" small>
                  <select
                    value={it.neckType}
                    onChange={(e) => updateItem(index, { neckType: e.target.value as NeckType })}
                    className="ui-input mt-0"
                  >
                    {NECK.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hand type" small>
                  <select
                    value={it.handType}
                    onChange={(e) => updateItem(index, { handType: e.target.value as HandType })}
                    className="ui-input mt-0"
                  >
                    {HAND.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Size category" small>
                  <select
                    value={it.size}
                    onChange={(e) => updateItem(index, { size: e.target.value as SizeCategory })}
                    className="ui-input mt-0"
                  >
                    {SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="sm:col-span-2 lg:col-span-3">
                  <ItemMeasurementFields
                    item={it}
                    onChange={(measurements) => updateItem(index, { measurements })}
                  />
                </div>

                <Field label="Notes" small className="sm:col-span-2 lg:col-span-3">
                  <textarea
                    value={it.notes}
                    onChange={(e) => updateItem(index, { notes: e.target.value })}
                    rows={2}
                    className="ui-input mt-0"
                  />
                </Field>

                <div className="sm:col-span-2 lg:col-span-3">
                  <ImageGalleryUploader
                    images={it.images || []}
                    onChange={(images: OrderItemImage[]) => updateItem(index, { images })}
                    orderItemId={it._id}
                    onError={setErr}
                  />
                </div>

                {!isCreate && it._id && (
                  <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3">
                    {it.barcodeValue && (
                      <div className="max-w-xs rounded-lg bg-canvas p-3">
                        <p className="ui-label">Item barcode</p>
                        <BarcodeImage value={it.barcodeValue} className="mt-2 h-14 w-full object-contain" />
                      </div>
                    )}
                    <Link
                      to={`/garments/${encodeURIComponent(it._id)}`}
                      className="text-sm font-semibold text-accent hover:underline"
                    >
                      Open garment floor view →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>

        {err && (
          <p className="text-sm text-red-700" role="alert">
            {err}
          </p>
        )}
        {msg && (
          <p className="text-sm text-accent" role="status">
            {msg}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-control bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {isCreate ? "Create order" : saving ? "Saving…" : "Save changes"}
          </button>
          {!isCreate && user?.role === "admin" && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-control border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              Delete order
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
  small,
  className = ""
}: {
  label: string;
  children: ReactNode;
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        className={`font-semibold text-ink-muted ${small ? "text-xs" : "text-sm"}`}
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
