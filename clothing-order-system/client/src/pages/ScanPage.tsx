import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { apiJson, ApiError, describeApiError } from "@/lib/api";
import type { ProductionStage, ScanDetails, Staff } from "@/lib/types";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole, isFloorRole, canSee } from "@/lib/roles";
import { stageLabel, shortOrderId, daysLabel, formatDate, formatMoney, labelBarcode } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { ProductionTimeline } from "@/components/ProductionTimeline";
import { SuggestedAssignments } from "@/components/SuggestedAssignments";
import { AssignmentChain } from "@/components/AssignmentChain";
import { SpecSheet } from "@/components/SpecSheet";
import { CameraScanPane } from "@/components/CameraScanPane";
import { SmartImage } from "@/components/SmartImage";
import clsx from "clsx";

export function ScanPage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [barcode, setBarcode] = useState(searchParams.get("barcode") || "");
  const [staffId, setStaffId] = useState("");
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [adminOverride, setAdminOverride] = useState(false);
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState<ScanDetails | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const action = details?.production?.action;
  const actionStage = (details?.production?.actionStage ||
    details?.timing.nextExpectedStage ||
    "SEWING_CUTTING") as ProductionStage;
  const manager = isManagerRole(user?.role);
  const floor = isFloorRole(user?.role);
  const canCheck = manager || floor;
  const canLabels = canSee(user?.role, "labels");
  const canOverride = manager;

  useEffect(() => {
    const fromUrl = searchParams.get("barcode");
    if (fromUrl) {
      setBarcode(fromUrl);
      lookupBarcode(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Staff[]>(
          `/api/staff?stage=${encodeURIComponent(actionStage)}&includeInactive=false`
        );
        if (!cancelled) {
          setStaffList(data);
          const assigned =
            details?.production?.assignment?.staff?._id || details?.production?.currentWorker?._id;
          if (assigned && data.some((s) => s._id === assigned)) setStaffId(assigned);
        }
      } catch {
        if (!cancelled) setStaffList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionStage, details?.production?.assignment?.staff?._id, details?.production?.currentWorker?._id]);

  async function lookupBarcode(value: string) {
    const v = value.trim();
    if (!v) return;
    try {
      const data = await apiJson<{ scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      setDetails(data.scanDetails);
      setFeedback(null);
      const assigned =
        data.scanDetails.production?.assignment?.staff?._id ||
        data.scanDetails.production?.currentWorker?._id;
      if (assigned) setStaffId(assigned);
    } catch (e) {
      setDetails(null);
      setFeedback({
        ok: false,
        message: describeApiError(e, "Barcode not found")
      });
    }
  }

  function onDecoded(decoded: string) {
    setBarcode(decoded);
    void lookupBarcode(decoded);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCheck || !barcode.trim() || !staffId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await apiJson<{
        ok: boolean;
        action: string;
        message: string;
        scanDetails: ScanDetails;
      }>("/api/production/scan", {
        method: "POST",
        body: JSON.stringify({
          barcodeValue: barcode.trim(),
          stage: actionStage,
          staffId,
          notes,
          adminOverride
        })
      });
      setFeedback({ ok: true, message: result.message });
      setDetails(result.scanDetails);
      setNotes("");
    } catch (ex) {
      const message = ex instanceof ApiError ? ex.message : "Scan failed";
      setFeedback({ ok: false, message });
      if (barcode.trim()) await lookupBarcode(barcode);
    } finally {
      setBusy(false);
    }
  }

  async function receiveAssignment() {
    const id = details?.production?.assignment?._id;
    if (!id) return;
    setBusy(true);
    try {
      await apiJson(`/api/production/assignments/${id}/receive`, { method: "POST" });
      await lookupBarcode(barcode);
      setFeedback({ ok: true, message: "Garment received" });
    } catch (e) {
      setFeedback({ ok: false, message: e instanceof ApiError ? e.message : "Could not mark received" });
    } finally {
      setBusy(false);
    }
  }

  async function handoverAssignment() {
    const id = details?.production?.assignment?._id;
    if (!id) return;
    setBusy(true);
    try {
      await apiJson(`/api/production/assignments/${id}/distribute`, { method: "POST" });
      await lookupBarcode(barcode);
      setFeedback({ ok: true, message: "Marked handed over" });
    } catch (e) {
      setFeedback({ ok: false, message: e instanceof ApiError ? e.message : "Could not mark handed over" });
    } finally {
      setBusy(false);
    }
  }

  const codes = new Set((details?.production?.allowedActions || []).map((a) => a.code));
  const actionLabel =
    action === "check_out"
      ? `Scan out / complete ${stageLabel(actionStage)}`
      : actionStage === "READY"
        ? "Mark ready"
        : `Scan in to ${stageLabel(actionStage)}`;

  return (
    <div className="-mx-4 min-h-[calc(100vh-4rem)] bg-canvas px-4 py-4 sm:-mx-6 sm:px-6 lg:py-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:items-start">
        <CameraScanPane onDecoded={onDecoded} />

        <aside className="space-y-3">
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

          <form id="scan-form" onSubmit={onSubmit} className="border border-line bg-surface p-4">
            <label className="ui-label" htmlFor="barcode">
              Barcode
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    lookupBarcode(barcode);
                  }
                }}
                className="ui-input mt-0 font-mono text-base"
                placeholder="ORD-293-1"
                autoComplete="off"
                autoFocus
              />
              <Button type="button" variant="secondary" onClick={() => lookupBarcode(barcode)}>
                Lookup
              </Button>
            </div>
          </form>

          {!details ? (
            <div className="border border-line bg-surface px-4 py-10 text-center text-sm text-ink-muted">
              Scan or look up a garment to see where it is, who has it, and what to do next.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-line bg-surface p-4">
                <p className="ui-label">What</p>
                <p className="mt-1 font-mono text-xs font-semibold text-ink">
                  {details.item.labelBarcode ||
                    labelBarcode(details.order.orderId, 1, details.item.barcodeValue)}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">{details.customer?.name || "—"}</p>
                <p className="text-sm text-ink-muted">
                  {details.item.clothingType}
                  {details.group?.name ? ` · ${details.group.name}` : ""}
                  {` · ${shortOrderId(details.order.orderId)}`}
                </p>
                {details.item.images?.[0]?.imageUrl ? (
                  <SmartImage
                    src={details.item.images[0].imageUrl}
                    alt=""
                    className="mt-3 h-20 w-20 rounded-control object-cover"
                  />
                ) : null}
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Fact k="Due" v={formatDate(details.timing.requiredCompletionDate)} warn={details.timing.overdue} />
                  <Fact k="Priority" v={details.order.priority || "NORMAL"} />
                  <Fact k="Status" v={details.production?.boardStatus?.replace(/_/g, " ") || details.order.productionStatus} />
                  <Fact k="Balance" v={formatMoney(details.pricing.balanceRemaining)} />
                </dl>
                <div className="mt-4">
                  <SpecSheet item={details.item} />
                </div>
              </div>

              <div className="border border-line bg-surface p-4 text-sm">
                <p className="ui-label">Where</p>
                <p className="mt-1 font-semibold capitalize text-ink">
                  {details.production?.location || stageLabel(details.timing.currentStage || "unstarted")}
                </p>
                <p className="mt-3 ui-label">Who</p>
                <p className="mt-1 font-medium text-ink">
                  Current: {details.production?.currentWorker?.name || details.production?.assignment?.staff?.name || "Unassigned"}
                </p>
                <p className="mt-1 text-ink-muted">
                  Next: {details.production?.nextWorker?.name || "—"}
                </p>
                <p className="mt-3 ui-label">What next</p>
                <p className="mt-1 capitalize text-ink">
                  {stageLabel(details.production?.nextStage || details.timing.nextExpectedStage)}
                </p>
                {details.production?.managerCommand && (
                  <p className="mt-3 bg-accent-soft px-3 py-2 text-sm text-accent">
                    {details.production.managerCommand}
                  </p>
                )}
              </div>

              {canCheck && (
                <div className="border border-line bg-surface space-y-3 p-4">
                  <label className="block text-sm">
                    <span className="ui-label">Workstation worker</span>
                    <select
                      required
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      className="ui-input"
                    >
                      <option value="">Select worker…</option>
                      {staffList.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name} · {s.activeAssignmentCount || 0} queued
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="ui-input"
                    placeholder="Optional note"
                  />
                  {canOverride && (
                    <label className="flex items-center gap-2 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        checked={adminOverride}
                        onChange={(e) => setAdminOverride(e.target.checked)}
                        className="h-4 w-4 accent-accent"
                      />
                      Override sequence
                    </label>
                  )}
                  <div className="flex flex-col gap-2">
                    {canOverride && codes.has("handover") && (
                      <Button type="button" variant="secondary" disabled={busy} onClick={handoverAssignment}>
                        Hand to workstation
                      </Button>
                    )}
                    {codes.has("receive") && (
                      <Button type="button" variant="secondary" disabled={busy} onClick={receiveAssignment}>
                        Confirm received
                      </Button>
                    )}
                    {(codes.has("check_in") ||
                      codes.has("check_out") ||
                      codes.has("start_first") ||
                      codes.has("mark_ready") ||
                      codes.has("send_next")) && (
                      <Button type="submit" form="scan-form" disabled={busy || !staffId}>
                        {busy ? "Working…" : actionLabel}
                      </Button>
                    )}
                    {canLabels && (
                      <Link to="/labels" className="text-center text-sm font-semibold text-accent">
                        Print / reprint label
                      </Link>
                    )}
                    {details.item._id && (
                      <Link
                        to={`/garments/${encodeURIComponent(details.item._id)}`}
                        className="text-center text-sm font-semibold text-accent"
                      >
                        Open garment / assignment path
                      </Link>
                    )}
                  </div>
                </div>
              )}

              <div className="border border-line bg-surface p-4">
                <p className="text-sm font-semibold text-ink">Production path</p>
                <ol className="mt-3 space-y-1.5 text-sm">
                  {(details.production?.assignmentChain || []).map((step) => (
                    <li key={step.stage} className="flex justify-between gap-2">
                      <span className="capitalize text-ink">
                        {step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : "○"}{" "}
                        {stageLabel(step.stage)}
                      </span>
                      <span className="text-ink-muted">{step.staff?.name || "—"}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {canOverride && details.item._id && (
                <AssignmentChain
                  orderItemId={details.item._id}
                  scan={details}
                  onSaved={() => lookupBarcode(barcode)}
                />
              )}

              {canOverride && details.item._id && (
                <SuggestedAssignments
                  orderItemId={details.item._id}
                  stage={actionStage}
                  onAssigned={(id) => {
                    setStaffId(id);
                    lookupBarcode(barcode);
                  }}
                />
              )}

              {details.item._id && (
                <div className="border border-line bg-surface p-4">
                  <p className="mb-3 text-sm font-semibold text-ink">What happened</p>
                  <ProductionTimeline orderItemId={details.item._id} stages={details.production?.stageStates} />
                </div>
              )}
              <p className="text-xs text-ink-faint">{daysLabel(details.timing.daysRemaining, details.timing.overdue)}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Fact({ k, v, warn }: { k: string; v?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">{k}</dt>
      <dd className={clsx("capitalize", warn && "font-semibold text-red-700")}>{v || "—"}</dd>
    </div>
  );
}
