import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order, ScanDetails } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { BarcodeImage } from "@/components/BarcodeImage";

type LabelItem = {
  key: string;
  barcode: string;
  orderId: string;
  customer: string;
  garment: string;
  due: string;
  priority: string;
};

export function LabelsWorkspacePage() {
  const { push } = useToast();
  const [q, setQ] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Record<string, LabelItem>>({});
  const [err, setErr] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
        const data = await apiJson<Order[]>(`/api/orders${qs}`);
        if (!cancelled) setOrders(data.slice(0, 40));
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Search failed");
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const labels = useMemo(() => Object.values(selected), [selected]);

  function addFromOrder(order: Order) {
    const next = { ...selected };
    for (const it of order.items) {
      const key = it._id || it.barcodeValue || `${order.orderId}-${it.clothingCode}`;
      next[key] = {
        key,
        barcode: it.barcodeValue || "",
        orderId: order.orderId,
        customer: order.customerName || order.customer?.name || "—",
        garment: it.clothingType,
        due: order.requiredCompletionDate,
        priority: order.priority || "NORMAL"
      };
    }
    setSelected(next);
    push(`Added ${order.items.length} label(s)`, "ok");
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
      setSelected((prev) => ({
        ...prev,
        [key]: {
          key,
          barcode: d.item.barcodeValue || v,
          orderId: d.order.orderId,
          customer: d.customer?.name || "—",
          garment: d.item.clothingType,
          due: d.timing.requiredCompletionDate,
          priority: d.order.priority || "NORMAL"
        }
      }));
      setBarcode("");
      push("Item added", "ok");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Barcode not found");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Print labels"
        description="Search an order or scan an item barcode. Preview, then print thermal-style labels."
        actions={
          <Button type="button" onClick={() => window.print()} disabled={!labels.length}>
            Print {labels.length || ""}
          </Button>
        }
      />

      {err && <ErrorState message={err} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] print:hidden">
        <div className="space-y-4">
          <div className="ui-card p-4">
            <label className="ui-label" htmlFor="label-q">
              Search orders
            </label>
            <input
              id="label-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="ui-input"
              placeholder="Customer, order ID…"
            />
            <ul className="mt-3 max-h-72 space-y-1 overflow-auto">
              {orders.map((o) => (
                <li key={o._id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-canvas">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {o.orderId} · {o.customerName || o.customer?.name}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {o.items.length} item(s) · due {formatDate(o.requiredCompletionDate)}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" onClick={() => addFromOrder(o)}>
                    Add items
                  </Button>
                </li>
              ))}
            </ul>
          </div>
          <div className="ui-card p-4">
            <label className="ui-label" htmlFor="label-bc">
              Scan or enter item barcode
            </label>
            <div className="flex gap-2">
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
                placeholder="ITM-…"
              />
              <Button type="button" variant="secondary" onClick={addFromBarcode}>
                Add
              </Button>
            </div>
          </div>
        </div>

        <aside className="ui-card p-4">
          <p className="text-sm font-semibold text-ink">Queue ({labels.length})</p>
          {labels.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">No labels selected.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {labels.map((l) => (
                <li key={l.key} className="flex items-start justify-between gap-2 text-xs">
                  <span>
                    <span className="font-medium text-ink">{l.garment}</span>
                    <span className="block font-mono text-ink-faint">{l.barcode}</span>
                  </span>
                  <button
                    type="button"
                    className="text-ink-muted hover:text-red-700"
                    onClick={() =>
                      setSelected((prev) => {
                        const next = { ...prev };
                        delete next[l.key];
                        return next;
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {labels.length === 0 ? (
        <div className="print:hidden">
          <EmptyState title="Nothing to print" body="Add items from an order or scan a barcode." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
          {labels.map((l) => (
            <article
              key={l.key}
              className="flex h-[160px] flex-col justify-between rounded border border-ink bg-white p-3 text-black"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-neutral-500">{l.orderId}</p>
                  <p className="text-sm font-semibold">{l.customer}</p>
                </div>
                {l.priority !== "NORMAL" && (
                  <span className="rounded border border-black px-1 text-[10px] font-bold">{l.priority}</span>
                )}
              </div>
              <p className="text-base font-semibold">{l.garment}</p>
              <div>
                {l.barcode ? <BarcodeImage value={l.barcode} className="h-10 w-full object-contain" /> : null}
                <p className="font-mono text-sm tracking-[0.2em]">{l.barcode}</p>
                <p className="text-[11px] text-neutral-600">Due {formatDate(l.due)}</p>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/** Order-specific print view used from an order detail. */
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
            title: order.orderId,
            subtitle: order.customerName,
            barcode: order.barcodeValue || order.orderId,
            due: order.requiredCompletionDate,
            priority: order.priority || "NORMAL"
          }
        ]
      : order.items.map((it) => ({
          title: it.clothingType,
          subtitle: `${order.orderId} · ${order.customerName}`,
          barcode: it.barcodeValue || it._id || it.clothingCode,
          due: order.requiredCompletionDate,
          priority: order.priority || "NORMAL"
        }));

  return (
    <div className="min-h-screen bg-white p-6 text-black">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-semibold">Print labels — {order.orderId}</h1>
          <p className="text-sm text-neutral-600">
            {mode === "order" ? "Order label" : "All item labels"}
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
            className="flex h-[160px] flex-col justify-between rounded border border-black p-3"
          >
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-500">{l.subtitle}</p>
              <p className="text-base font-semibold">{l.title}</p>
            </div>
            <div>
              {l.barcode ? <BarcodeImage value={l.barcode} className="h-10 w-full object-contain print:h-12" /> : null}
              <p className="font-mono text-sm tracking-[0.2em]">{l.barcode}</p>
              <p className="text-[11px]">Due {formatDate(l.due)}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
