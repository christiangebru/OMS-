import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiJson, ApiError, describeApiError } from "@/lib/api";
import type { NextMove, ProductionStage, ScanDetails, Staff } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole, isFloorRole, canSee } from "@/lib/roles";
import { stageLabel, shortOrderId, daysLabel, formatDate, formatMoney, labelBarcode } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { AssignmentChain } from "@/components/AssignmentChain";
import { SpecSheet } from "@/components/SpecSheet";
import { CameraScanPane } from "@/components/CameraScanPane";
import { SmartImage } from "@/components/SmartImage";
import clsx from "clsx";

/** Locations and order steps: no workstation worker needed. */
const STAFF_OPTIONAL: string[] = ["RECEIVED", "OFF_SITE", "SHOWROOM", "READY", "PACKAGING", "DELIVERED"];
/** Steps that only ever happen off-site (cannot be moved into the shop). */
const OFF_SITE_ONLY = ["FRINGE_TWISTING"];

type ScanResult = { ok: boolean; action: string; message: string; scanDetails: ScanDetails };

/**
 * Scan → see who and what it is → ONE big button for the next step
 * (received, give to worker, done → next station, back from off-site).
 * Everything else is behind "Details".
 */
export function ScanPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [barcode, setBarcode] = useState(searchParams.get("barcode") || "");
  const [details, setDetails] = useState<ScanDetails | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Next-step worker (pre-filled with the assigned or suggested one).
  const [workerId, setWorkerId] = useState("");
  const [workers, setWorkers] = useState<Staff[]>([]);
  // Off-site trip: who takes it is free text, never a staff record.
  const [tripName, setTripName] = useState("");
  const [tripPhone, setTripPhone] = useState("");
  const [tripDue, setTripDue] = useState("");

  const manager = isManagerRole(user?.role);
  const canCheck = manager || isFloorRole(user?.role);
  const canLabels = canSee(user?.role, "labels");
  const move = details?.production?.move;
  const isOrderScan = details?.scanKind === "order" || !details?.item;
  const toStage = move?.toStage || "";
  const goingOffSite = Boolean(move && (move.toOffSite || move.kind === "send"));

  useEffect(() => {
    const fromUrl = searchParams.get("barcode");
    if (fromUrl) {
      setBarcode(fromUrl);
      void lookupBarcode(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // New garment or new step: reset the form to the suggestion.
  useEffect(() => {
    setWorkerId(move?.worker?._id || "");
    setTripName("");
    setTripPhone("");
    setTripDue("");
  }, [details?.item?._id, move?.kind, move?.toStage, move?.worker?._id]);

  useEffect(() => {
    if (!move?.needsWorker || !toStage) {
      setWorkers([]);
      return;
    }
    let cancelled = false;
    apiJson<Staff[]>(`/api/staff?stage=${encodeURIComponent(toStage)}&includeInactive=false`)
      .then((list) => !cancelled && setWorkers(list))
      .catch(() => !cancelled && setWorkers([]));
    return () => {
      cancelled = true;
    };
  }, [move?.needsWorker, toStage]);

  async function lookupBarcode(value: string) {
    const v = value.trim();
    if (!v) return;
    try {
      const data = await apiJson<{ scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      setDetails(data.scanDetails);
      setFeedback(null);
    } catch (e) {
      setDetails(null);
      setFeedback({ ok: false, message: describeApiError(e, "Barcode not found") });
    }
  }

  function onDecoded(decoded: string) {
    setBarcode(decoded);
    void lookupBarcode(decoded);
  }

  function scanCall(stage: string, staffId?: string, extra: Record<string, unknown> = {}) {
    return apiJson<ScanResult>("/api/production/scan", {
      method: "POST",
      body: JSON.stringify({ barcodeValue: barcode.trim(), stage, staffId: staffId || undefined, ...extra })
    });
  }

  const trip = () => ({
    offSiteHandlerName: tripName.trim(),
    offSiteHandlerPhone: tripPhone.trim(),
    expectedReturnAt: tripDue || undefined
  });

  /** Do the main move. A transfer is two scans: out of here, into the next. */
  async function doMove(m: NextMove, opts: { skipStorage?: boolean } = {}) {
    if (!details?.item?._id) return;
    setBusy(true);
    setFeedback(null);
    let step = "";
    try {
      let result: ScanResult | { message: string; scanDetails: ScanDetails } | null = null;
      if (m.kind === "receive" && !opts.skipStorage) {
        result = await apiJson(`/api/production/items/${details.item._id}/receive`, { method: "POST", body: "{}" });
      } else if (m.kind === "send" || (m.kind === "receive" && m.toOffSite)) {
        result = await scanCall("OFF_SITE", undefined, trip());
      } else if (m.kind === "start" || m.kind === "receive" || m.kind === "back") {
        result = await scanCall(m.toStage!, workerId);
      } else if (m.kind === "transfer") {
        const holder =
          details.production?.currentWorker?._id || details.production?.assignment?.staff?._id || workerId;
        step = `Checked out of ${stageLabel(m.fromStage || "")}`;
        result = await scanCall(m.fromStage!, holder);
        if (m.toOffSite) result = await scanCall("OFF_SITE", undefined, trip());
        else if (m.toStage) result = await scanCall(m.toStage, m.needsWorker ? workerId : undefined);
        step = "";
      }
      if (result) {
        setDetails(result.scanDetails);
        setFeedback({ ok: true, message: moveDoneMessage(m, workers.find((w) => w._id === workerId)?.name, tripName) });
      }
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Could not move it";
      await lookupBarcode(barcode);
      setFeedback({ ok: false, message: step ? `${step}, but: ${message}` : message });
    } finally {
      setBusy(false);
    }
  }

  /** Route change for this garment only: send the next step out, or keep it in. */
  async function changeRoute(stage: string, offSite: boolean) {
    if (!details?.item?._id) return;
    setBusy(true);
    try {
      await apiJson(`/api/production/items/${details.item._id}/off-site-route`, {
        method: "POST",
        body: JSON.stringify({ stage, offSite })
      });
      await lookupBarcode(barcode);
      setFeedback({ ok: true, message: `${stageLabel(stage)} will be done ${offSite ? "off-site" : "in the shop"}` });
    } catch (e) {
      setFeedback({ ok: false, message: e instanceof ApiError ? e.message : "Could not change the route" });
    } finally {
      setBusy(false);
    }
  }

  const code = details
    ? isOrderScan
      ? details.order.barcodeValue || shortOrderId(details.order.orderId)
      : details.item?.labelBarcode || labelBarcode(details.order.orderId, 1, details.item?.barcodeValue)
    : "";

  return (
    <div className="-mx-4 min-h-[calc(100vh-4rem)] bg-canvas px-4 py-4 sm:-mx-6 sm:px-6 lg:py-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] lg:items-start">
        <CameraScanPane onDecoded={onDecoded} />

        <aside className="space-y-3">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              void lookupBarcode(barcode);
            }}
            className="flex gap-2"
          >
            <input
              id="barcode"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              className="ui-input mt-0 font-mono text-base"
              placeholder="Type a code: 1001-1"
              aria-label="Barcode"
              autoComplete="off"
              autoFocus
            />
            <Button type="submit" variant="secondary">
              Find
            </Button>
          </form>

          {feedback && (
            <div
              className={clsx(
                "px-4 py-3 text-sm font-semibold",
                feedback.ok ? "bg-accent-soft text-accent" : "bg-red-50 text-red-800"
              )}
              role="status"
            >
              {feedback.message}
            </div>
          )}

          {!details ? (
            <div className="border border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
              Scan a label to see what to do with it.
            </div>
          ) : isOrderScan ? (
            <OrderScan details={details} code={code} canCheck={canCheck} onDone={(d, msg) => { setDetails(d); setFeedback({ ok: true, message: msg }); }} onError={(msg) => setFeedback({ ok: false, message: msg })} />
          ) : (
            <>
              {/* Who and what */}
              <section className="border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-xl font-semibold text-ink">{details.customer?.name || "—"}</p>
                    <p className="text-sm text-ink-muted">
                      {details.item?.clothingType}
                      {details.group?.name ? ` · ${details.group.name}` : ""}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-ink-faint">{code}</p>
                  </div>
                  {details.item?.images?.[0]?.imageUrl ? (
                    <SmartImage src={details.item.images[0].imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-control object-cover" />
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  <Chip tone={details.timing.overdue ? "red" : "plain"}>
                    {daysLabel(details.timing.daysRemaining, details.timing.overdue)} · {formatDate(details.timing.requiredCompletionDate)}
                  </Chip>
                  {details.order.priority && details.order.priority !== "NORMAL" && <Chip tone="amber">{details.order.priority}</Chip>}
                </div>
                <p className="mt-3 text-sm text-ink">
                  <span className="text-ink-muted">Now: </span>
                  <span className="font-semibold">{whereNow(details)}</span>
                </p>
              </section>

              {/* The one thing to do */}
              {move && canCheck && (
                <section className="space-y-3 border-2 border-accent bg-surface p-4">
                  <MoveBody move={move} />

                  {move.needsWorker && ["receive", "start", "transfer", "back"].includes(move.kind) && (
                    <label className="block text-sm">
                      <span className="ui-label">{stageLabel(toStage)} worker</span>
                      <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className="ui-input text-base">
                        <option value="">Choose…</option>
                        {workers.map((s) => (
                          <option key={s._id} value={s._id}>
                            {s.name}
                            {s._id === move.worker?._id ? (move.suggested ? " (suggested)" : " (assigned)") : ""} ·{" "}
                            {s.activeAssignmentCount || 0} in queue
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {goingOffSite && move.kind !== "receive" && (
                    <div className="space-y-2 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-900">Who is taking it? (optional)</p>
                      <input value={tripName} onChange={(e) => setTripName(e.target.value)} className="ui-input mt-0" placeholder="Name" maxLength={120} />
                      <div className="grid grid-cols-2 gap-2">
                        <input value={tripPhone} onChange={(e) => setTripPhone(e.target.value)} className="ui-input mt-0" placeholder="Phone" inputMode="tel" maxLength={40} />
                        <input type="date" value={tripDue} onChange={(e) => setTripDue(e.target.value)} className="ui-input mt-0" aria-label="Expected back" />
                      </div>
                    </div>
                  )}

                  {move.kind !== "none" && move.kind !== "parts" && (
                    <Button
                      type="button"
                      size="lg"
                      className="w-full"
                      disabled={busy || (move.needsWorker && move.kind !== "receive" && !workerId)}
                      onClick={() => void doMove(move)}
                    >
                      {busy ? "Working…" : moveButtonLabel(move, workers.find((w) => w._id === workerId)?.name)}
                    </Button>
                  )}
                  {move.kind === "receive" && move.toStage && (
                    <button
                      type="button"
                      disabled={busy || (move.needsWorker && !workerId)}
                      onClick={() => void doMove(move, { skipStorage: true })}
                      className="w-full text-center text-sm font-semibold text-accent disabled:opacity-50"
                    >
                      Or give it straight to {move.toOffSite ? "off-site" : stageLabel(move.toStage)}
                      {move.needsWorker && workerId ? ` (${workers.find((w) => w._id === workerId)?.name || ""})` : ""}
                    </button>
                  )}
                </section>
              )}

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
                  {showDetails ? "Hide details" : "Details"}
                </Button>
                {canLabels && (
                  <Link to="/labels" className="inline-flex min-h-10 items-center rounded-control border border-line px-3 text-sm font-medium text-ink hover:bg-surface">
                    Print label
                  </Link>
                )}
                {details.item?._id && (
                  <Link
                    to={`/garments/${encodeURIComponent(details.item._id)}`}
                    className="inline-flex min-h-10 items-center rounded-control border border-line px-3 text-sm font-medium text-ink hover:bg-surface"
                  >
                    Garment page
                  </Link>
                )}
              </div>

              {showDetails && (
                <ItemDetails
                  details={details}
                  manager={manager}
                  busy={busy}
                  move={move}
                  onRoute={changeRoute}
                  onRefresh={() => lookupBarcode(barcode)}
                />
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function whereNow(d: ScanDetails) {
  const p = d.production;
  const m = p?.move;
  if (p?.offSiteTrip && !p.offSiteTrip.returnedAt) {
    const t = p.offSiteTrip;
    return `Off-site${t.handlerName ? ` with ${t.handlerName}` : ""}${t.expectedReturnAt ? ` · back ${formatDate(t.expectedReturnAt)}` : ""}`;
  }
  if (m?.kind === "transfer" && m.fromStage) {
    const who = p?.currentWorker?.name;
    return `${stageLabel(m.fromStage)}${who ? ` · ${who}` : ""}`;
  }
  if (m?.kind === "none") return stageLabel(d.timing.currentStage || "SHOWROOM");
  if (m && !m.received && (m.kind === "receive")) return "Not received yet";
  return "With the manager";
}

function MoveBody({ move }: { move: NextMove }) {
  const to = move.toOffSite ? "Off-site" : stageLabel(move.toStage || "");
  switch (move.kind) {
    case "receive":
      return (
        <div>
          <p className="ui-label">First scan</p>
          <p className="text-lg font-semibold text-ink">Mark it received, then store it</p>
          <p className="text-xs text-ink-muted">Next step after that: {to}</p>
        </div>
      );
    case "transfer":
      return (
        <div>
          <p className="ui-label">Finished at {stageLabel(move.fromStage || "")}?</p>
          <p className="text-lg font-semibold text-ink">Next: {to}</p>
          {move.toOffSite && move.offSiteFor.length > 0 && (
            <p className="text-xs text-ink-muted">For {move.offSiteFor.map((s) => stageLabel(s)).join(", ")}</p>
          )}
        </div>
      );
    case "back":
      return (
        <div>
          <p className="ui-label">Came back?</p>
          <p className="text-lg font-semibold text-ink">Next: {to}</p>
        </div>
      );
    case "parts":
      return (
        <div>
          <p className="ui-label">Made in parts</p>
          <p className="text-lg font-semibold text-ink">
            {move.parts?.ready || 0} of {move.parts?.total || 0} parts ready
          </p>
          <p className="text-xs text-ink-muted">
            Scan the part labels ({move.parts?.codes.join(", ")}) to move them. This garment goes to final sewing when
            all parts are ready.
          </p>
        </div>
      );
    case "none":
      return (
        <div>
          <p className="ui-label">Nothing to do</p>
          <p className="text-lg font-semibold text-ink">Finished — scan the order label to pack it</p>
        </div>
      );
    default:
      return (
        <div>
          <p className="ui-label">Next step</p>
          <p className="text-lg font-semibold text-ink">{to}</p>
          {move.toOffSite && move.offSiteFor.length > 0 && (
            <p className="text-xs text-ink-muted">For {move.offSiteFor.map((s) => stageLabel(s)).join(", ")}</p>
          )}
        </div>
      );
  }
}

function moveButtonLabel(m: NextMove, workerName?: string) {
  const to = m.toOffSite ? "send off-site" : stageLabel(m.toStage || "");
  const who = m.needsWorker && workerName ? ` · ${workerName}` : "";
  switch (m.kind) {
    case "receive":
      return "Received at the shop";
    case "send":
      return "Send off-site";
    case "transfer":
      return `Done → ${to}${who}`;
    case "back":
      return `Back → ${to}${who}`;
    default:
      return `Give to ${to}${who}`;
  }
}

function moveDoneMessage(m: NextMove, workerName?: string, tripName?: string) {
  if (m.kind === "receive") return "Received — put it in storage";
  if (m.toOffSite || m.kind === "send") return `Sent off-site${tripName ? ` with ${tripName}` : ""}`;
  return `Now at ${stageLabel(m.toStage || "")}${workerName && m.needsWorker ? ` · ${workerName}` : ""}`;
}

function Chip({ tone, children }: { tone: "plain" | "red" | "amber"; children: React.ReactNode }) {
  return (
    <span
      className={clsx(
        "rounded-control px-2 py-0.5 font-medium",
        tone === "red" ? "bg-red-50 text-red-800" : tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-canvas text-ink-muted"
      )}
    >
      {children}
    </span>
  );
}

function ItemDetails({
  details,
  manager,
  busy,
  move,
  onRoute,
  onRefresh
}: {
  details: ScanDetails;
  manager: boolean;
  busy: boolean;
  move?: NextMove;
  onRoute: (stage: string, offSite: boolean) => void;
  onRefresh: () => void;
}) {
  const next = move?.toStage;
  const canSendOut =
    manager && next && !move?.toOffSite && !STAFF_OPTIONAL.includes(next) && ["receive", "start", "transfer", "back"].includes(move?.kind || "");
  const keepIn = (move?.offSiteFor || []).filter((s) => !OFF_SITE_ONLY.includes(s));
  return (
    <div className="space-y-3">
      <section className="border border-line bg-surface p-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Fact k="Order" v={shortOrderId(details.order.orderId)} />
          <Fact k="Balance" v={formatMoney(details.pricing.balanceRemaining)} />
        </dl>
        {details.item && (
          <div className="mt-4">
            <SpecSheet item={details.item} />
          </div>
        )}
      </section>

      {manager && (canSendOut || (move?.toOffSite && keepIn.length > 0)) && (
        <section className="space-y-2 border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-ink">Change the route (this garment only)</p>
          {canSendOut && (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => onRoute(next!, true)}>
              Send {stageLabel(next!)} off-site instead
            </Button>
          )}
          {move?.toOffSite &&
            keepIn.map((st) => (
              <Button key={st} type="button" variant="secondary" disabled={busy} onClick={() => onRoute(st, false)}>
                Do {stageLabel(st)} in the shop instead
              </Button>
            ))}
        </section>
      )}

      {(details.production?.assignmentChain || []).length > 0 && (
        <section className="border border-line bg-surface p-4">
          <p className="text-sm font-semibold text-ink">Route</p>
          <ol className="mt-3 space-y-1.5 text-sm">
            {(details.production?.assignmentChain || []).map((step, i) => (
              <li key={`${step.stage}-${i}`} className="flex justify-between gap-2">
                <span className="text-ink">
                  {step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : "○"} {stageLabel(step.stage)}
                </span>
                <span className="text-ink-muted">{step.staff?.name || "—"}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {manager && details.item?._id && (
        <AssignmentChain orderItemId={details.item._id} scan={details} onSaved={onRefresh} />
      )}

      {details.item?._id && (
        <section className="border border-line bg-surface p-4">
          <p className="mb-3 text-sm font-semibold text-ink">What happened</p>
          <ProductionTimeline orderItemId={details.item._id} stages={details.production?.stageStates} />
        </section>
      )}
    </div>
  );
}

/** Order label (ORD-n): pack or hand over the whole order. */
function OrderScan({
  details,
  code,
  canCheck,
  onDone,
  onError
}: {
  details: ScanDetails;
  code: string;
  canCheck: boolean;
  onDone: (d: ScanDetails, message: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const action = details.production?.action;
  const stage = (details.production?.actionStage || details.timing.nextExpectedStage) as ProductionStage;
  const incomplete = details.production?.incompleteItems || [];
  const label =
    action === "pack" || stage === "PACKAGING"
      ? "Pack order"
      : action === "deliver" || stage === "DELIVERED"
        ? "Mark picked up / delivered"
        : null;

  async function run() {
    setBusy(true);
    try {
      const r = await apiJson<ScanResult>("/api/production/scan", {
        method: "POST",
        body: JSON.stringify({ barcodeValue: code, stage })
      });
      onDone(r.scanDetails, r.message);
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Could not do that");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border border-line bg-surface p-4">
      <div>
        <p className="text-xl font-semibold text-ink">{details.customer?.name || "—"}</p>
        <p className="text-sm text-ink-muted">
          Whole order · <span className="font-mono">{code}</span>
        </p>
      </div>
      <ul className="divide-y divide-line text-sm">
        {(details.order.siblingItems || []).map((g) => (
          <li key={g._id} className="flex justify-between gap-2 py-1.5">
            <span className="text-ink">{g.clothingType}</span>
            <span className="text-ink-muted">{stageLabel(g.currentStage || "") || "Not started"}</span>
          </li>
        ))}
      </ul>
      {action === "blocked" || incomplete.length > 0 ? (
        <p className="bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Not ready to pack: {incomplete.length} garment{incomplete.length === 1 ? "" : "s"} still in production.
        </p>
      ) : (
        canCheck &&
        label && (
          <Button type="button" size="lg" className="w-full" disabled={busy} onClick={() => void run()}>
            {busy ? "Working…" : label}
          </Button>
        )
      )}
    </section>
  );
}

function Fact({ k, v }: { k: string; v?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{k}</dt>
      <dd>{v || "—"}</dd>
    </div>
  );
}
