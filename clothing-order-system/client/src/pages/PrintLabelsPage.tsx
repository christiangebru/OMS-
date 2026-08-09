import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Order } from "@/lib/types";

/** Browser print-ready labels using @media print */
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

  if (err) return <p className="p-6 text-red-600">{err}</p>;
  if (!order) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  const labels =
    mode === "order"
      ? [
          {
            title: order.orderId,
            subtitle: order.customerName,
            barcode: order.barcodeValue || order.orderId
          }
        ]
      : order.items.map((it) => ({
          title: it.clothingType,
          subtitle: `${order.orderId} · ${it.clothingCode}`,
          barcode: it.barcodeValue || it._id || it.clothingCode
        }));

  return (
    <div className="print-root min-h-screen bg-white p-6 text-black">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-lg font-bold">Print labels — {order.orderId}</h1>
          <p className="text-sm text-slate-600">
            {mode === "order" ? "Order label" : "All item labels"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Print
          </button>
          <Link
            to={`/orders/${encodeURIComponent(order.orderId)}`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Back
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3">
        {labels.map((l, i) => (
          <div
            key={i}
            className="flex h-[30mm] w-[50mm] flex-col items-center justify-center border border-slate-300 p-2 text-center"
            style={{ pageBreakInside: "avoid" }}
          >
            <div className="text-[10px] font-bold leading-tight">{l.title}</div>
            <div className="text-[8px] text-slate-600">{l.subtitle}</div>
            <div className="mt-1 font-mono text-[9px] tracking-wider">{l.barcode}</div>
            <div
              className="mt-1 h-8 w-full bg-[repeating-linear-gradient(90deg,#000_0,#000_1px,#fff_1px,#fff_3px)]"
              aria-hidden
            />
          </div>
        ))}
      </div>

      <style>{`
        @media print {
          .print-hidden, .print\\:hidden { display: none !important; }
          body { margin: 0; }
          .print-root { padding: 8mm; }
        }
      `}</style>
    </div>
  );
}
