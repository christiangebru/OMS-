import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiJson, ApiError, describeApiError } from "@/lib/api";
import type { Order, ScanDetails } from "@/lib/types";
import { formatDate, shortOrderId } from "@/lib/format";
import { EmptyState, ErrorState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { LabelCard } from "@/components/LabelCard";
import {
  flattenOrderLabels,
  labelsForOrder,
  savedPrintMode,
  savePrintMode,
  type Label,
  type OrderLabels,
  type PrintMode
} from "@/lib/labels";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";

/** Page size for the browser print dialog, per print mode. */
function PageSizeStyle({ mode }: { mode: PrintMode }) {
  const css =
    mode === "roll"
      ? "@media print { @page { size: 50mm 30mm; margin: 0; } }"
      : "@media print { @page { size: A4; margin: 8mm; } }";
  return <style>{css}</style>;
}

function PrintModeToggle({ mode, onChange }: { mode: PrintMode; onChange: (m: PrintMode) => void }) {
  return (
    <div className="flex rounded-control border border-line bg-surface p-0.5 text-xs" role="group" aria-label="Print on">
      {(
        [
          ["roll", "Sticker roll 50×30 mm"],
          ["sheet", "A4 sticker sheet"]
        ] as const
      ).map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          className={clsx(
            "min-h-9 rounded-control px-3 font-medium",
            mode === id ? "bg-accent text-white" : "text-ink-muted hover:text-ink"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Print-only: exactly the stickers being printed, flat, true size. */
function PrintSheet({ labels, mode }: { labels: Label[]; mode: PrintMode }) {
  return (
    <div className="label-sheet" data-mode={mode}>
      {labels.map((l) => (
        <LabelCard key={`print-${l.key}`} label={l} mode={mode} screenScale={1} />
      ))}
    </div>
  );
}

function usePrintMode() {
  const [mode, setMode] = useState<PrintMode>(savedPrintMode);
  return [
    mode,
    (m: PrintMode) => {
      setMode(m);
      savePrintMode(m);
    }
  ] as const;
}

export function LabelsWorkspacePage() {
  const { push } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // Labels are only selectable after "Select labels to print", so a stray tap
  // never selects anything.
  const [selecting, setSelecting] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [toPrint, setToPrint] = useState<Label[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = usePrintMode();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Order[]>("/api/orders");
        if (!cancelled) setOrders(data.filter((o) => o.productionStatus !== "delivered"));
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

  const groups = useMemo(() => orders.map(labelsForOrder), [orders]);
  const allLabels = useMemo(() => groups.flatMap(flattenOrderLabels), [groups]);

  /** Groups that match the filter; a matching part or accessory opens its parent. */
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups.map((g) => ({ g, autoOpen: new Set<string>() }));
    const hit = (l: Label) =>
      [l.code, l.title, l.subtitle, l.orderId, shortOrderId(l.orderId)].some((v) =>
        String(v || "").toLowerCase().includes(q)
      );
    return groups
      .map((g) => {
        const autoOpen = new Set<string>();
        g.garments.forEach((x) => {
          if (x.parts.some(hit)) autoOpen.add(x.label.key);
        });
        if (g.accessories.some(hit)) autoOpen.add(g.order.key);
        const match =
          hit(g.order) || g.customer.toLowerCase().includes(q) || g.garments.some((x) => hit(x.label)) || autoOpen.size > 0;
        return match ? { g, autoOpen } : null;
      })
      .filter(Boolean) as Array<{ g: OrderLabels; autoOpen: Set<string> }>;
  }, [groups, filter]);

  const selectedLabels = allLabels.filter((l) => selected[l.key]);

  function setMany(labels: Label[], on: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      for (const l of labels) next[l.key] = on;
      return next;
    });
  }

  function print(labels: Label[]) {
    if (!labels.length) return;
    setToPrint(labels);
    window.setTimeout(() => window.print(), 80);
  }

  async function addFromBarcode() {
    const v = barcode.trim();
    if (!v) return;
    setErr(null);
    try {
      const data = await apiJson<{ scanKind: string; scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      const orderId = data.scanDetails.order.orderId;
      if (!orders.some((o) => o.orderId === orderId)) {
        const o = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
        setOrders((prev) => [o, ...prev]);
      }
      setFilter(data.scanKind === "order" ? orderId : data.scanDetails.item?.labelBarcode || v);
      setBarcode("");
      push(`Showing ${shortOrderId(orderId)}`, "ok");
    } catch (e) {
      setErr(describeApiError(e, "Barcode not found"));
    }
  }

  /** A sticker on screen. While selecting, tapping it toggles it (a garment takes its parts along). */
  const card = (l: Label, extra: Label[] = []) => {
    const on = Boolean(selected[l.key]);
    if (!selecting) return <LabelCard label={l} mode={mode} />;
    return (
      <button
        type="button"
        aria-pressed={on}
        aria-label={`${on ? "Deselect" : "Select"} ${l.code}`}
        onClick={() => setMany([l, ...extra], !on)}
        className={clsx(
          "relative block rounded-[3px] text-left outline-offset-4 transition",
          on ? "ring-4 ring-accent ring-offset-2" : "opacity-60 hover:opacity-100"
        )}
      >
        <span
          className={clsx(
            "absolute -right-2.5 -top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-sm font-bold",
            on ? "border-accent bg-accent text-white" : "border-line bg-surface text-transparent"
          )}
          aria-hidden
        >
          ✓
        </span>
        <LabelCard label={l} mode={mode} />
      </button>
    );
  };

  /** Quiet but easy to tap: opens the stickers that live inside a parent. */
  const reveal = (key: string, isOpen: boolean, text: string) => (
    <button
      type="button"
      aria-expanded={isOpen}
      onClick={() => setOpen((p) => ({ ...p, [key]: !isOpen }))}
      className={clsx(
        "flex min-h-10 w-full items-center justify-between gap-2 rounded-control border px-3 text-sm font-medium transition",
        isOpen
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-line bg-canvas text-ink-muted hover:border-accent/40 hover:text-ink"
      )}
    >
      <span>{isOpen ? `Hide ${text}` : `Show ${text}`}</span>
      <span aria-hidden className={clsx("transition-transform", isOpen && "rotate-180")}>
        ▾
      </span>
    </button>
  );

  return (
    <div className="space-y-6">
      <PageSizeStyle mode={mode} />
      <PrintSheet
        labels={toPrint.length ? toPrint : selectedLabels.length ? selectedLabels : allLabels}
        mode={mode}
      />

      <div className="label-screen space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">Labels</h1>
            <p className="mt-1 text-sm text-ink-muted">
              {groups.length} orders · {allLabels.length} stickers. Parts are inside their garment, accessories inside
              their order.
            </p>
          </div>
          <PrintModeToggle mode={mode} onChange={setMode} />
        </header>

        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-control border border-line bg-surface/95 p-2 shadow-sm backdrop-blur">
          {!selecting ? (
            <>
              <Button type="button" onClick={() => setSelecting(true)} disabled={!allLabels.length}>
                Select labels to print
              </Button>
              <Button type="button" variant="secondary" onClick={() => print(allLabels)} disabled={!allLabels.length}>
                Print all ({allLabels.length})
              </Button>
            </>
          ) : (
            <>
              <Button type="button" onClick={() => print(selectedLabels)} disabled={!selectedLabels.length}>
                Print selected ({selectedLabels.length})
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setMany(visible.flatMap(({ g }) => flattenOrderLabels(g)), true)}
              >
                Select all shown
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelected({})} disabled={!selectedLabels.length}>
                Clear
              </Button>
              <span className="ml-auto hidden text-xs text-ink-muted sm:inline">
                Tap labels to select. A garment brings its parts.
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSelecting(false);
                  setSelected({});
                }}
              >
                Done
              </Button>
            </>
          )}
        </div>

        {err && <ErrorState message={err} />}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="ui-label" htmlFor="label-filter">
              Find
            </label>
            <input
              id="label-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="ui-input"
              placeholder="Customer, ORD-1002, ORD-1002-1-WR, dress…"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="ui-label" htmlFor="label-bc">
              Scan or type a code
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="label-bc"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void addFromBarcode();
                  }
                }}
                className="ui-input font-mono"
                placeholder="ORD-1002-1"
              />
              <Button type="button" variant="secondary" onClick={() => void addFromBarcode()}>
                Go
              </Button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading labels…</p>
        ) : !groups.length ? (
          <EmptyState title="No labels yet" body="Create an order to get its labels." />
        ) : !visible.length ? (
          <EmptyState title="Nothing matches" body="Clear the search to see every order." />
        ) : (
          <div className="space-y-4">
            {visible.map(({ g, autoOpen }) => {
              const all = flattenOrderLabels(g);
              const accOpen = open[g.order.key] ?? autoOpen.has(g.order.key);
              return (
                <section key={g.order.key} className="ui-card space-y-4 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-base font-semibold text-ink">{shortOrderId(g.orderId)}</p>
                      <p className="text-xs text-ink-muted">
                        {g.customer} · due {formatDate(g.order.due)} · {all.length} sticker{all.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    {selecting && (
                      <Button type="button" size="sm" variant="secondary" onClick={() => setMany(all, true)}>
                        Select whole order ({all.length})
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-start gap-5">
                    <div className="space-y-2">
                      {card(g.order)}
                      {g.accessories.length > 0 &&
                        reveal(
                          g.order.key,
                          accOpen,
                          `${g.accessories.length} accessor${g.accessories.length === 1 ? "y" : "ies"}`
                        )}
                    </div>

                    {g.garments.map(({ label, parts }) => {
                      const partsOpen = open[label.key] ?? autoOpen.has(label.key);
                      return (
                        <div key={label.key} className="space-y-2">
                          {card(label, parts)}
                          {parts.length > 0 &&
                            reveal(label.key, partsOpen, `${parts.length} part label${parts.length === 1 ? "" : "s"}`)}
                        </div>
                      );
                    })}
                  </div>

                  {accOpen && g.accessories.length > 0 && (
                    <div className="rounded-control border border-dashed border-line p-3">
                      <p className="mb-2 text-xs font-semibold text-ink-muted">Accessories of {shortOrderId(g.orderId)}</p>
                      <div className="flex flex-wrap gap-4">
                        {g.accessories.map((l) => (
                          <div key={l.key}>{card(l)}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {g.garments.map(({ label, parts }) =>
                    parts.length && (open[label.key] ?? autoOpen.has(label.key)) ? (
                      <div key={`parts-${label.key}`} className="rounded-control border border-dashed border-line p-3">
                        <p className="mb-2 text-xs font-semibold text-ink-muted">
                          Parts of {label.code} · {label.title}
                        </p>
                        <div className="flex flex-wrap gap-4">
                          {parts.map((p) => (
                            <div key={p.key}>{card(p)}</div>
                          ))}
                        </div>
                      </div>
                    ) : null
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** One order's labels, opened from the order page (prints straight away). */
export function PrintLabelsPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [params] = useSearchParams();
  const onlyOrder = params.get("mode") === "order";
  const [order, setOrder] = useState<Order | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = usePrintMode();

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    (async () => {
      try {
        const o = await apiJson<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
        if (!cancelled) {
          setOrder(o);
          setTimeout(() => window.print(), 500);
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

  const g = labelsForOrder(order);
  const labels = onlyOrder ? [g.order] : flattenOrderLabels(g);

  return (
    <div className="min-h-screen bg-white p-6 text-black print:p-0">
      <PageSizeStyle mode={mode} />
      <PrintSheet labels={labels} mode={mode} />
      <div className="label-screen">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Labels — {shortOrderId(order.orderId)}</h1>
            <p className="text-sm text-neutral-600">
              {onlyOrder ? "Order label" : `${labels.length} stickers`} · {g.customer}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintModeToggle mode={mode} onChange={setMode} />
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
        <div className="flex flex-wrap gap-4">
          {labels.map((l) => (
            <LabelCard key={l.key} label={l} mode={mode} />
          ))}
        </div>
      </div>
    </div>
  );
}
