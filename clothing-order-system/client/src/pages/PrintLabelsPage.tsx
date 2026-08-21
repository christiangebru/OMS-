import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order, ScanDetails } from "@/lib/types";
import { formatDate, labelBarcode, shortOrderId } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { BarcodeImage } from "@/components/BarcodeImage";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";

type LabelItem = {
  key: string;
  barcode: string;
  orderId: string;
  customer: string;
  garment: string;
  due: string;
  priority: string;
  quantity: number;
  location?: string;
};

function toLabel(order: Order, it: Order["items"][number], index: number): LabelItem {
  const key = it._id || it.barcodeValue || `${order.orderId}-${it.clothingCode}`;
  return {
    key,
    barcode: it.labelBarcode || labelBarcode(order.orderId, index, it.barcodeValue),
    orderId: order.orderId,
    customer: order.customerName || order.customer?.name || "—",
    garment: it.clothingType,
    due: order.requiredCompletionDate,
    priority: order.priority || "NORMAL",
    quantity: it.quantity || 1,
    location: it.currentStage || it.nextStage || ""
  };
}

export function LabelsWorkspacePage() {
  const { push } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selecting, setSelecting] = useState(false);
  const [printAll, setPrintAll] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Order[]>("/api/orders");
        if (cancelled) return;
        const open = data.filter((o) => o.productionStatus !== "delivered");
        setOrders(open);
        setSelected({});
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Could not load labels");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const done = () => setPrintAll(false);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, []);

  const allLabels = useMemo(() => {
    const rows: LabelItem[] = [];
    for (const o of orders) {
      o.items.forEach((it, idx) => rows.push(toLabel(o, it, idx + 1)));
    }
    return rows.filter((l) => l.barcode);
  }, [orders]);

  const selectedCount = allLabels.filter((l) => selected[l.key]).length;

  function toggle(key: string) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectAll() {
    const next: Record<string, boolean> = {};
    for (const l of allLabels) next[l.key] = true;
    setSelected(next);
    setSelecting(true);
  }

  function printSelected() {
    if (!selectedCount) return;
    setPrintAll(false);
    window.print();
  }

  function printEveryLabel() {
    setPrintAll(true);
    window.setTimeout(() => window.print(), 50);
  }

  async function addFromBarcode() {
    const v = barcode.trim();
    if (!v) return;
    try {
      const data = await apiJson<{ scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      const d = data.scanDetails;
      const key = d.item._id;
      setOrders((prev) => {
        if (prev.some((o) => o.items.some((it) => it._id === key))) return prev;
        return [
          {
            _id: d.order._id,
            orderId: d.order.orderId,
            customerName: d.customer?.name || "—",
            customerPhone: d.customer?.phone || "",
            items: [
              {
                _id: d.item._id,
                clothingCode: d.item.clothingCode,
                clothingType: d.item.clothingType,
                fabricType: d.item.fabricType,
                color: d.item.color,
                quantity: d.item.quantity,
                notes: d.item.notes,
                neckType: d.item.neckType as never,
                handType: d.item.handType as never,
                size: d.item.size as never,
                barcodeValue: d.item.barcodeValue,
                labelBarcode: d.item.labelBarcode,
                productionDays: 3,
                unitPrice: 0
              }
            ],
            requiredCompletionDate: d.timing.requiredCompletionDate,
            productionStatus: d.order.productionStatus,
            priority: d.order.priority,
            createdAt: d.order.createdAt || new Date().toISOString(),
            updatedAt: d.order.createdAt || new Date().toISOString()
          },
          ...prev
        ];
      });
      setSelected((prev) => ({ ...prev, [key]: true }));
      setBarcode("");
      push("Label added", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Barcode not found");
    }
  }

  return (
    <div className="space-y-6 print:space-y-4 print:bg-white">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Print Labels</h1>
          <p className="mt-1 text-sm text-ink-muted">{allLabels.length} labels ready</p>
        </div>
        <Button type="button" onClick={printEveryLabel} disabled={!allLabels.length}>
          Print all ({allLabels.length})
        </Button>
      </header>

      {err && (
        <div className="print:hidden">
          <ErrorState message={err} />
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="min-w-[240px] flex-1">
          <label className="ui-label" htmlFor="label-bc">
            Add barcode
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="label-bc"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFromBarcode();
                }
              }}
              className="ui-input font-mono"
              placeholder="ORD-293-1"
            />
            <Button type="button" variant="secondary" onClick={addFromBarcode}>
              Add
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Button
          type="button"
          variant={selecting ? "primary" : "secondary"}
          onClick={() => setSelecting((v) => !v)}
          disabled={!allLabels.length}
        >
          Select barcodes to print
        </Button>
        {selecting && (
          <>
            <p className="text-sm text-ink-muted">Selected: {selectedCount}</p>
            <Button type="button" variant="secondary" onClick={selectAll} disabled={!allLabels.length}>
              Select all
            </Button>
            <Button type="button" variant="ghost" onClick={() => setSelected({})} disabled={!selectedCount}>
              Deselect all
            </Button>
            <Button type="button" onClick={printSelected} disabled={!selectedCount}>
              Print selected ({selectedCount})
            </Button>
          </>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted print:hidden">Loading labels…</p>
      ) : allLabels.length === 0 ? (
        <div className="print:hidden">
          <EmptyState title="No barcode labels" body="Create an order to generate printable labels." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 print:grid-cols-2 print:bg-white">
          {allLabels.map((l) => {
            const on = Boolean(selected[l.key]);
            const hideForPrint = !printAll && !on;
            return (
              <article
                key={l.key}
                className={clsx(
                  "label-print relative flex h-[200px] flex-col justify-between bg-white p-3 text-black",
                  "border border-neutral-800",
                  selecting && on && "ring-2 ring-accent",
                  hideForPrint && "print:hidden",
                  selecting && !on && "opacity-70"
                )}
              >
                {selecting && (
                  <label className="print:hidden absolute right-2 top-2 flex h-6 w-6 items-center justify-center border border-neutral-800 bg-white">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-accent"
                      checked={on}
                      onChange={() => toggle(l.key)}
                      aria-label={on ? "Deselect label" : "Select label"}
                    />
                  </label>
                )}
                <div className="flex items-start justify-between gap-2 pr-6">
                  <div>
                    <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                      Atelier OMS
                    </p>
                    <p className="mt-0.5 font-mono text-base font-semibold tracking-tight">
                      {shortOrderId(l.orderId)}
                    </p>
                    <p className="text-[13px] text-neutral-700">{l.customer}</p>
                  </div>
                  {l.priority !== "NORMAL" && (
                    <span className="border border-black px-1.5 py-0.5 text-[10px] font-bold">{l.priority}</span>
                  )}
                </div>
                <p className="text-lg font-semibold leading-tight">{l.garment}</p>
                <div>
                  {l.barcode ? (
                    <BarcodeImage value={l.barcode} className="h-12 w-full object-contain object-left print:h-14" />
                  ) : null}
                  <p className="font-mono text-sm tracking-[0.16em]">{l.barcode}</p>
                  <p className="mt-0.5 text-[11px] text-neutral-600">
                    Due {formatDate(l.due)}
                    {l.quantity > 1 ? ` · Qty ${l.quantity}` : ""}
                    {l.location ? ` · ${l.location}` : ""}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PrintLabelsPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [params] = useSearchParams();
  const mode = params.get("mode") === "order" ? "order" : "items";
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!cancelled) {
          setOrder(o);
          setTimeout(() => window.print(), 400);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (err) return <p className="p-6 text-red-700">{err}</p>;
  if (!order) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-pulse rounded-full bg-line" />
      </div>
    );
  }

  const labels =
    mode === "order"
      ? [
          {
            title: shortOrderId(order.orderId),
            subtitle: order.customerName,
            barcode: order.barcodeValue || order.orderId,
            due: order.requiredCompletionDate,
            priority: order.priority || "NORMAL",
            qty: 1
          }
        ]
      : order.items.map((it, idx) => ({
          title: it.clothingType,
          subtitle: `${shortOrderId(order.orderId)} · ${order.customerName}`,
          barcode: it.labelBarcode || labelBarcode(order.orderId, idx + 1, it.barcodeValue),
          due: order.requiredCompletionDate,
          priority: order.priority || "NORMAL",
          qty: it.quantity
        }));

  return (
    <div className="min-h-screen bg-white p-6 text-black print:bg-white">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-semibold">Print labels — {shortOrderId(order.orderId)}</h1>
          <p className="text-sm text-neutral-600">
            {mode === "order" ? "Order label" : `${labels.length} item labels`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={() => window.print()}>
            Print
          </Button>
          <Link to={`/orders/${encodeURIComponent(order.orderId)}`}>
            <Button variant="secondary" type="button">
              Back
            </Button>
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {labels.map((l) => (
          <article
            key={l.barcode}
            className="label-print flex h-[200px] flex-col justify-between border border-black bg-white p-3"
          >
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-500">Atelier OMS</p>
              <p className="text-[10px] uppercase tracking-wide text-neutral-500">{l.subtitle}</p>
              <p className="text-base font-semibold">{l.title}</p>
            </div>
            <div>
              {l.barcode ? <BarcodeImage value={l.barcode} className="h-10 w-full object-contain print:h-12" /> : null}
              <p className="font-mono text-sm tracking-[0.16em]">{l.barcode}</p>
              <p className="text-[11px]">
                Due {formatDate(l.due)}
                {l.qty > 1 ? ` · Qty ${l.qty}` : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
