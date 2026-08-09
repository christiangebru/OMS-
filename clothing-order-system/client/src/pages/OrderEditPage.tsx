import { FormEvent, type ReactNode, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiJson, ApiError, balanceRemaining, apiBaseUrl, authToken } from "@/lib/api";
import type {
  Customer,
  HandType,
  Measurement,
  NeckType,
  Order,
  OrderItem,
  OrderItemImage,
  OrderPriority,
  ProductionStatus,
  SizeCategory
} from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { CustomerPicker } from "@/components/CustomerPicker";
import { ImageGalleryUploader } from "@/components/ImageGalleryUploader";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { SuggestedAssignments } from "@/components/SuggestedAssignments";
import type { ProductionStage } from "@/lib/types";

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
  const [loading, setLoading] = useState(!isCreate);

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setMsg(null);
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
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {isCreate ? "New order" : `Order ${orderId}`}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Customer profiles, multi-image items, pricing, and barcodes.
          </p>
          {!isCreate && barcodeValue && (
            <p className="mt-1 font-mono text-xs text-slate-500">Barcode: {barcodeValue}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCreate && (
            <>
              <Link
                to={`/orders/${encodeURIComponent(orderId!)}/print-labels?mode=order`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
              >
                Print order label
              </Link>
              <Link
                to={`/orders/${encodeURIComponent(orderId!)}/print-labels`}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
              >
                Print all item labels
              </Link>
              <button
                type="button"
                onClick={() =>
                  openPdf(`/api/orders/${encodeURIComponent(orderId!)}/barcode-labels/batch`)
                }
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
              >
                PDF batch
              </button>
            </>
          )}
          <Link to="/orders" className="text-sm font-semibold text-brand-600 hover:underline">
            ← Back to list
          </Link>
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-6"
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
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="group">
              Group code (optional)
            </label>
            <input
              id="group"
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
              placeholder="e.g. WEDDING-2026"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="due">
              Required completion date
            </label>
            <input
              id="due"
              type="date"
              required
              value={requiredDate}
              onChange={(e) => setRequiredDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="status">
              Production status
            </label>
            <select
              id="status"
              value={productionStatus}
              onChange={(e) => setProductionStatus(e.target.value as ProductionStatus)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="priority">
              Priority
            </label>
            <select
              id="priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as OrderPriority)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="agreed">
              Total agreed price
            </label>
            <input
              id="agreed"
              type="number"
              min={0}
              step="0.01"
              value={totalAgreedPrice}
              onChange={(e) => setTotalAgreedPrice(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="deposit">
              Deposit paid
            </label>
            <input
              id="deposit"
              type="number"
              min={0}
              step="0.01"
              value={depositPaid}
              onChange={(e) => setDepositPaid(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">Balance remaining</p>
            <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
              {balance.toFixed(2)}
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Clothing items</h2>
            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Add item
            </button>
          </div>

          {items.map((it, index) => (
            <div
              key={it._id || index}
              className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Item {index + 1}
                  {it.barcodeValue ? (
                    <span className="ml-2 font-mono font-normal normal-case text-slate-400">
                      {it.barcodeValue}
                    </span>
                  ) : null}
                </span>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Clothing code" small>
                  <input
                    required
                    value={it.clothingCode}
                    onChange={(e) => updateItem(index, { clothingCode: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Clothing type" small>
                  <input
                    required
                    value={it.clothingType}
                    onChange={(e) => updateItem(index, { clothingType: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Fabric type" small>
                  <input
                    required
                    value={it.fabricType}
                    onChange={(e) => updateItem(index, { fabricType: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Color" small>
                  <input
                    required
                    value={it.color}
                    onChange={(e) => updateItem(index, { color: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Quantity" small>
                  <input
                    type="number"
                    min={1}
                    required
                    value={it.quantity}
                    onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Unit price" small>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={it.unitPrice}
                    onChange={(e) => updateItem(index, { unitPrice: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Production days" small>
                  <input
                    type="number"
                    min={1}
                    value={it.productionDays}
                    onChange={(e) => updateItem(index, { productionDays: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>
                <Field label="Neck type" small>
                  <select
                    value={it.neckType}
                    onChange={(e) => updateItem(index, { neckType: e.target.value as NeckType })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    {SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                  <h3 className="mb-3 text-sm font-semibold">Measurements (per order)</h3>
                  <select
                    value={it.measurements?.gender || "female"}
                    onChange={(e) =>
                      updateItem(index, {
                        measurements: {
                          ...it.measurements,
                          gender: e.target.value as "female" | "male" | "kids"
                        }
                      })
                    }
                    className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="female">female</option>
                    <option value="male">male</option>
                    <option value="kids">Kids / Babies</option>
                  </select>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["vest", "Vest"],
                        ["height", "Height"],
                        ["breast", "Breast"],
                        ["chest", "Chest"],
                        ["waist", "Waist"],
                        ["shoulder", "Shoulder"],
                        ["arm", "Arm / sleeve"]
                      ] as const
                    ).map(([key, label]) => (
                      <input
                        key={key}
                        placeholder={label}
                        value={it.measurements?.[key] || ""}
                        onChange={(e) =>
                          updateItem(index, {
                            measurements: {
                              gender: it.measurements?.gender || "female",
                              ...it.measurements,
                              [key]: e.target.value
                            }
                          })
                        }
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      />
                    ))}
                  </div>
                </div>

                <Field label="Notes" small className="sm:col-span-2 lg:col-span-3">
                  <textarea
                    value={it.notes}
                    onChange={(e) => updateItem(index, { notes: e.target.value })}
                    rows={2}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </Field>

                <div className="sm:col-span-2 lg:col-span-3">
                  <ImageGalleryUploader
                    images={it.images || []}
                    onChange={(images: OrderItemImage[]) => updateItem(index, { images })}
                    onError={setErr}
                  />
                </div>

                {!isCreate && it._id && (
                  <div className="sm:col-span-2 lg:col-span-3 space-y-4">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Production timeline
                      </p>
                      <ProductionTimeline orderItemId={it._id} />
                    </div>
                    <SuggestedAssignments
                      orderItemId={it._id}
                      stage={
                        (it.stageCheckpoints?.find((c) => !c.checkedOutAt)?.stage as
                          | ProductionStage
                          | undefined) ||
                        ("RECEIVED" as ProductionStage)
                      }
                      onAssigned={() =>
                        setMsg("Staff assigned — use Scan page to check in")
                      }
                    />
                    <Link
                      to="/scan"
                      className="inline-block text-sm font-semibold text-brand-600 hover:underline"
                    >
                      Open Scan floor →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </section>

        {err && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {err}
          </p>
        )}
        {msg && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
            {msg}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-brand-700"
          >
            {isCreate ? "Create order" : "Save changes"}
          </button>
          {!isCreate && user?.role === "admin" && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
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
        className={`font-semibold text-slate-600 dark:text-slate-300 ${small ? "text-xs" : "text-sm"}`}
      >
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
