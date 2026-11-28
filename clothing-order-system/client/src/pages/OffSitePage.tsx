import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiJson, describeApiError } from "@/lib/api";
import type { OffSiteTrip, OrderItem } from "@/lib/types";
import { formatDate, shortOrderId, stageLabel } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Skeleton, Badge } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { LabelCard } from "@/components/LabelCard";
import { PageSizeStyle, PrintModeToggle, PrintSheet, usePrintMode } from "./PrintLabelsPage";
import type { Label } from "@/lib/labels";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";

type Row = {
  itemId: string;
  code: string;
  orderId: string;
  customer: { name: string; phone: string };
  clothingType: string;
  itemKind: string;
  measurements: OrderItem["measurements"] | null;
  notes: string;
  due: string;
  priority: string;
  outsourced: boolean;
  trip: OffSiteTrip | null;
  message: string;
  /** To send only: the steps this trip covers. */
  offSiteFor?: string[];
};

/** Short size line to match a returned garment by hand. */
function sizes(m: Row["measurements"]) {
  if (!m) return "";
  return [
    m.waist && `Waist ${m.waist}`,
    (m.inseam || "") && `Length ${m.inseam}`,
    m.vest && `Hip ${m.vest}`,
    m.chest && `Chest ${m.chest}`,
    m.shoulder && `Shoulder ${m.shoulder}`
  ]
    .filter(Boolean)
    .join(" · ");
}

function telegramLink(text: string) {
  const [first, ...rest] = text.split("\n");
  return `https://t.me/share/url?url=${encodeURIComponent(first)}&text=${encodeURIComponent(rest.join("\n"))}`;
}

const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

/**
 * Garments with outside makers. Trousers are made entirely outside: they are
 * sent by message (no scan) and get their label printed when they come back.
 */
export function OffSitePage() {
  const { push } = useToast();
  const [data, setData] = useState<{ away: Row[]; toSend: Row[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sending, setSending] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", due: "" });
  const [messageFor, setMessageFor] = useState<Row | null>(null);
  const [returned, setReturned] = useState<Label | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = usePrintMode();

  const load = useCallback(async () => {
    try {
      setData(await apiJson<{ away: Row[]; toSend: Row[] }>("/api/off-site"));
      setErr(null);
    } catch (e) {
      setErr(describeApiError(e, "Could not load off-site work"));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 30000);

  const match = useCallback(
    (r: Row) => {
      const t = q.trim().toLowerCase();
      if (!t) return true;
      return [r.code, r.orderId, r.customer.name, r.clothingType, r.trip?.handlerName, sizes(r.measurements)].some((v) =>
        String(v || "").toLowerCase().includes(t)
      );
    },
    [q]
  );

  const toSend = (data?.toSend || []).filter(match);
  const awayGroups = useMemo(() => {
    const groups = new Map<string, Row[]>();
    for (const r of (data?.away || []).filter(match)) {
      const who = r.trip?.handlerName?.trim() || "No name recorded";
      if (!groups.has(who)) groups.set(who, []);
      groups.get(who)!.push(r);
    }
    return [...groups.entries()];
  }, [data, match]);
  const knownMakers = useMemo(
    () => [...new Set((data?.away || []).map((r) => r.trip?.handlerName?.trim()).filter(Boolean) as string[])],
    [data]
  );

  function startSend(r: Row) {
    setSending(r);
    setForm({ name: knownMakers[0] || "", phone: "", due: r.due ? String(r.due).slice(0, 10) : "" });
  }

  async function confirmSend() {
    if (!sending) return;
    setBusy(sending.itemId);
    try {
      const res = await apiJson<{ row: Row }>(`/api/off-site/items/${sending.itemId}/send`, {
        method: "POST",
        body: JSON.stringify({
          offSiteHandlerName: form.name.trim(),
          offSiteHandlerPhone: form.phone.trim(),
          expectedReturnAt: form.due || undefined
        })
      });
      setSending(null);
      setMessageFor(res.row);
      await load();
    } catch (e) {
      setErr(describeApiError(e, "Could not mark as sent"));
    } finally {
      setBusy(null);
    }
  }

  async function share(r: Row) {
    try {
      await navigator.share({ text: r.message });
    } catch {
      /* closed the share menu */
    }
  }

  async function copy(r: Row) {
    try {
      await navigator.clipboard.writeText(r.message);
      push("Message copied", "ok");
    } catch {
      push("Could not copy — select the text and copy it", "err");
    }
  }

  async function markBack(r: Row) {
    setBusy(r.itemId);
    try {
      const res = await apiJson<{ completed: boolean; code: string }>(`/api/off-site/items/${r.itemId}/back`, {
        method: "POST",
        body: "{}"
      });
      push(`${res.code} is back`, "ok");
      if (r.outsourced) {
        // It never had a label: print it now, to stick on.
        setReturned({
          key: `back-${r.itemId}`,
          kind: "garment",
          code: res.code,
          title: r.clothingType,
          subtitle: r.customer.name || "—",
          due: r.due,
          priority: r.priority,
          orderId: r.orderId
        });
      }
      await load();
    } catch (e) {
      setErr(describeApiError(e, "Could not mark as back"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageSizeStyle mode={mode} />
      {returned && <PrintSheet labels={[returned]} mode={mode} />}

      <div className="label-screen space-y-6">
        <PageHeader
          title="Off-site"
          description="Everything that goes to outside people: trousers, off-site cutting, netela fringe twisting. Trousers and tilet netelas get their label when they come back."
        />
        {err && <ErrorState message={err} />}

        <input
          className="ui-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find: code, customer, maker, or a size like 82"
          aria-label="Find off-site garment"
        />

        {!data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">
                To send <span className="text-ink-muted">({toSend.length})</span>
              </h2>
              {toSend.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing waiting to be sent.</p>
              ) : (
                <ul className="space-y-2">
                  {toSend.map((r) => (
                    <li key={r.itemId} className="ui-card space-y-3 p-4">
                      <RowHead r={r} />
                      {sending?.itemId === r.itemId ? (
                        <div className="grid gap-2 rounded-control bg-canvas p-3 sm:grid-cols-3">
                          <label className="text-xs text-ink-muted sm:col-span-1">
                            Maker
                            <input
                              className="ui-input mt-1"
                              list="known-makers"
                              value={form.name}
                              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                              placeholder="Name"
                              autoFocus
                            />
                          </label>
                          <label className="text-xs text-ink-muted">
                            Phone (optional)
                            <input
                              className="ui-input mt-1"
                              inputMode="tel"
                              value={form.phone}
                              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                            />
                          </label>
                          <label className="text-xs text-ink-muted">
                            Due back
                            <input
                              type="date"
                              className="ui-input mt-1"
                              value={form.due}
                              onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
                            />
                          </label>
                          <div className="flex gap-2 sm:col-span-3">
                            <Button type="button" disabled={busy === r.itemId} onClick={confirmSend}>
                              {busy === r.itemId ? "Saving…" : "Mark as sent & get message"}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setSending(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button type="button" onClick={() => startSend(r)}>
                          Send to maker
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-ink">
                Away <span className="text-ink-muted">({(data.away || []).length})</span>
              </h2>
              {awayGroups.length === 0 ? (
                <EmptyState title="Nothing is away" body="Garments sent to outside makers show here until they come back." />
              ) : (
                awayGroups.map(([who, rows]) => (
                  <div key={who} className="ui-card space-y-2 p-4">
                    <p className="text-sm font-semibold text-ink">
                      {who} <span className="font-normal text-ink-muted">· {rows.length} away</span>
                    </p>
                    <ul className="divide-y divide-line">
                      {rows.map((r) => (
                        <li key={r.itemId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                          <RowHead r={r} />
                          <div className="flex gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={() => setMessageFor(r)}>
                              Message
                            </Button>
                            <Button type="button" size="sm" disabled={busy === r.itemId} onClick={() => void markBack(r)}>
                              {busy === r.itemId ? "…" : "Back"}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>

      <datalist id="known-makers">
        {knownMakers.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {messageFor && (
        <Dialog title={`Message for ${messageFor.trip?.handlerName || "the maker"}`} onClose={() => setMessageFor(null)}>
          <pre className="whitespace-pre-wrap rounded-control bg-canvas p-3 font-mono text-sm text-ink">
            {messageFor.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button type="button" onClick={() => void share(messageFor)}>
                Share…
              </Button>
            )}
            <Button type="button" variant={canShare ? "secondary" : "primary"} onClick={() => void copy(messageFor)}>
              Copy message
            </Button>
            <a
              href={telegramLink(messageFor.message)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 items-center rounded-control border border-line px-3 text-sm font-medium text-ink hover:bg-canvas"
            >
              Open in Telegram
            </a>
          </div>
          <p className="text-xs text-ink-muted">Ask the maker to write the code on a piece of tape inside the garment.</p>
        </Dialog>
      )}

      {returned && (
        <Dialog title={`${returned.code} is back — print its label`} onClose={() => setReturned(null)}>
          <div className="flex justify-center">
            <LabelCard label={returned} mode={mode} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => window.print()}>
              Print label
            </Button>
            <PrintModeToggle mode={mode} onChange={setMode} />
          </div>
          <p className="text-xs text-ink-muted">Stick it on the garment. It is now in the showroom.</p>
        </Dialog>
      )}
    </div>
  );
}

function RowHead({ r }: { r: Row }) {
  const trip = r.trip;
  return (
    <div className="min-w-0">
      <p className="font-mono text-sm font-semibold text-ink">
        {r.code}{" "}
        {r.priority !== "NORMAL" && <Badge tone={r.priority === "VIP" ? "accent" : "warn"}>{r.priority}</Badge>}
      </p>
      <p className="text-sm text-ink">
        {r.clothingType} · {r.customer.name || "—"} ·{" "}
        <Link className="text-accent" to={`/orders/${encodeURIComponent(r.orderId)}`}>
          {shortOrderId(r.orderId)}
        </Link>
      </p>
      {!r.trip && (r.offSiteFor?.length || 0) > 0 && (
        <p className="text-xs text-ink-muted">
          {r.outsourced && r.offSiteFor!.includes("SEWING_CUTTING")
            ? "Made by the maker"
            : `For: ${r.offSiteFor!.map((st) => stageLabel(st)).join(", ")}`}
        </p>
      )}
      {sizes(r.measurements) && <p className="text-xs text-ink-muted">{sizes(r.measurements)}</p>}
      <p className={clsx("text-xs", trip?.overdue ? "font-semibold text-red-700" : "text-ink-muted")}>
        {trip
          ? `Due back ${trip.expectedReturnAt ? formatDate(trip.expectedReturnAt) : "—"}${trip.overdue ? " · late" : ""}`
          : `Order due ${formatDate(r.due)}`}
      </p>
    </div>
  );
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="label-screen fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg space-y-3 rounded-lg bg-surface p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="min-h-9 rounded-control px-2 text-ink-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
