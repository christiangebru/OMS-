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

/** Locations and order steps: no workstation worker needed. */
const STAFF_OPTIONAL: string[] = ["RECEIVED", "OFF_SITE", "SHOWROOM", "READY", "PACKAGING", "DELIVERED"];

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
  // Off-site trip: who takes the garment is free text, never a staff record.
  const [sendOffSite, setSendOffSite] = useState(false);
  const [tripName, setTripName] = useState("");
  const [tripPhone, setTripPhone] = useState("");
  const [tripDue, setTripDue] = useState("");

  const action = details?.production?.action;
  const actionStage = (details?.production?.actionStage ||
    details?.timing.nextExpectedStage ||
    "SEWING_CUTTING") as ProductionStage;
  const offSiteOptions = details?.production?.offSiteOptions;
  const canSendOffSite = action === "check_in" && Boolean(offSiteOptions?.sendNextStage);
  const sendingOffSite = sendOffSite && canSendOffSite;
  /** Stage actually scanned: OFF_SITE when the manager sends the next stage out. */
  const scanStage: ProductionStage = sendingOffSite ? "OFF_SITE" : actionStage;
  const isOrderLevel = details?.scanKind === "order" || !details?.item;
  const leavingForOffSite = action === "check_in" && scanStage === "OFF_SITE";
  const staffRequired = !isOrderLevel && !STAFF_OPTIONAL.includes(scanStage);
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
    setSendOffSite(false);
    setTripName("");
    setTripPhone("");
    setTripDue("");
  }, [details?.item?._id, details?.production?.actionStage, action]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Staff[]>(
          STAFF_OPTIONAL.includes(scanStage)
            ? `/api/staff?includeInactive=false`
            : `/api/staff?stage=${encodeURIComponent(scanStage)}&includeInactive=false`
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
  }, [scanStage, details?.production?.assignment?.staff?._id, details?.production?.currentWorker?._id]);

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
    if (!canCheck || !barcode.trim() || (staffRequired && !staffId)) return;
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
          stage: scanStage,
          staffId: leavingForOffSite ? undefined : staffId || undefined,
          notes,
          adminOverride,
          ...(sendingOffSite ? { offSiteFor: actionStage } : {}),
          ...(leavingForOffSite
            ? {
                offSiteHandlerName: tripName.trim(),
                offSiteHandlerPhone: tripPhone.trim(),
                expectedReturnAt: tripDue || undefined
              }
            : {})
        })
      });
      setFeedback({ ok: true, message: result.message });
      setDetails(result.scanDetails);
      setNotes("");
    } catch (ex) {
      const message = ex instanceof ApiError ? ex.message : "Scan failed";
      // Refresh first: lookupBarcode clears feedback, and the error must stay visible.
      if (barcode.trim()) await lookupBarcode(barcode);
      setFeedback({ ok: false, message });
    } finally {
      setBusy(false);
    }
  }

  /** Keep planned off-site stages in the shop for this garment only. */
  async function keepInShop() {
    const stages = offSiteOptions?.plannedStages || [];
    if (!details?.item?._id || !stages.length) return;
    setBusy(true);
    try {
      for (const stage of stages) {
        await apiJson(`/api/production/items/${details.item._id}/off-site-route`, {
          method: "POST",
          body: JSON.stringify({ stage, offSite: false })
        });
      }
      await lookupBarcode(barcode);
      setFeedback({ ok: true, message: `${stages.map((st) => stageLabel(st)).join(", ")} will be done in the shop` });
    } catch (e) {
      setFeedback({ ok: false, message: e instanceof ApiError ? e.message : "Could not change the route" });
    } finally {
      setBusy(false);
    }
  }

  const codes = new Set((details?.production?.allowedActions || []).map((a) => a.code));
  const isOrderScan = isOrderLevel;
  const offSite =
    details?.production?.offSite ||
    details?.production?.locationKind === "off_site" ||
    actionStage === "OFF_SITE";
  const actionLabel =
    action === "pack" || (isOrderScan && actionStage === "PACKAGING")
      ? "Pack order"
      : action === "deliver" || (isOrderScan && actionStage === "DELIVERED")
        ? "Mark pickup / delivery"
        : action === "blocked"
          ? "Cannot pack yet"
          : action === "check_out" && offSite
            ? "Back from off-site"
            : sendingOffSite
              ? `Send ${stageLabel(actionStage)} off-site`
              : action === "check_in" && actionStage === "OFF_SITE"
                ? "Send off-site"
              : action === "check_out"
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
                placeholder="ORD-1001 or ORD-1001-1"
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
              Scan a garment barcode, or the order barcode (ORD-n) when packing.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="border border-line bg-surface p-4">
                <p className="ui-label">What</p>
                <p className="mt-1 font-mono text-xs font-semibold text-ink">
                  {isOrderScan
                    ? details.order.barcodeValue || shortOrderId(details.order.orderId)
                    : details.item?.labelBarcode ||
                      labelBarcode(details.order.orderId, 1, details.item?.barcodeValue)}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">{details.customer?.name || "—"}</p>
                <p className="text-sm text-ink-muted">
                  {isOrderScan
                    ? `Order · ${shortOrderId(details.order.orderId)}`
                    : `${details.item?.clothingType || ""}${details.group?.name ? ` · ${details.group.name}` : ""} · ${shortOrderId(details.order.orderId)}`}
                </p>
                {details.item?.images?.[0]?.imageUrl ? (
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
                {details.item ? (
                  <div className="mt-4">
                    <SpecSheet item={details.item} />
                  </div>
                ) : null}
                {isOrderScan && (details.production?.incompleteItems?.length || 0) > 0 && (
                  <ul className="mt-4 space-y-1 text-sm text-red-800">
                    {details.production?.incompleteItems?.map((g) => (
                      <li key={g._id}>
                        {g.clothingType} · {g.barcodeValue} · {stageLabel(g.currentStage || "unstarted")}
                      </li>
                    ))}
                  </ul>
                )}
                {isOrderScan && (
                  <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                    {(details.order.siblingItems || []).map((g) => (
                      <li key={g._id}>
                        {g.clothingType} · {g.labelBarcode || g.barcodeValue} · {stageLabel(g.currentStage || "")}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border border-line bg-surface p-4 text-sm">
                <p className="ui-label">Where</p>
                <p className={clsx("mt-1 font-semibold text-ink", offSite && "text-amber-800")}>
                  {details.production?.location ||
                    (offSite ? "Off-site" : stageLabel(details.timing.currentStage || "unstarted"))}
                </p>
                {!isOrderScan && (
                  <>
                    <p className="mt-3 ui-label">Who</p>
                    <p className="mt-1 font-medium text-ink">
                      Current: {details.production?.currentWorker?.name || details.production?.assignment?.staff?.name || "Unassigned"}
                    </p>
                    <p className="mt-1 text-ink-muted">
                      Next: {details.production?.nextWorker?.name || "—"}
                    </p>
                  </>
                )}
                <p className="mt-3 ui-label">What next</p>
                <p className="mt-1 capitalize text-ink">
                  {stageLabel(details.production?.nextStage || details.timing.nextExpectedStage)}
                </p>
                {details.production?.offSiteTrip?.handlerPhone && (
                  <p className="mt-1 text-xs text-amber-800">
                    Phone: {details.production.offSiteTrip.handlerPhone}
                  </p>
                )}
                {details.production?.managerCommand && (
                  <p className="mt-3 bg-accent-soft px-3 py-2 text-sm text-accent">
                    {details.production.managerCommand}
                  </p>
                )}
              </div>

              {canCheck && (
                <div className="border border-line bg-surface space-y-3 p-4">
                  {leavingForOffSite ? (
                    <div className="space-y-2 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-900">
                        Who is taking it? All optional — for responsibility only.
                      </p>
                      <input
                        value={tripName}
                        onChange={(e) => setTripName(e.target.value)}
                        className="ui-input mt-0"
                        placeholder="Name of person taking it"
                        maxLength={120}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={tripPhone}
                          onChange={(e) => setTripPhone(e.target.value)}
                          className="ui-input mt-0"
                          placeholder="Phone"
                          inputMode="tel"
                          maxLength={40}
                        />
                        <label className="text-[11px] text-ink-muted">
                          Expected back
                          <input
                            type="date"
                            value={tripDue}
                            onChange={(e) => setTripDue(e.target.value)}
                            className="ui-input mt-0"
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                  <label className="block text-sm">
                    <span className="ui-label">
                      {staffRequired ? "Workstation worker" : "Staff (optional)"}
                    </span>
                    <select
                      required={staffRequired}
                      value={staffId}
                      onChange={(e) => setStaffId(e.target.value)}
                      className="ui-input"
                    >
                      <option value="">{staffRequired ? "Select worker…" : "No worker"}</option>
                      {staffList.map((s) => (
                        <option key={s._id} value={s._id}>
                          {s.name} · {s.activeAssignmentCount || 0} queued
                        </option>
                      ))}
                    </select>
                  </label>
                  )}
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
                    {canOverride && canSendOffSite && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => setSendOffSite((v) => !v)}
                      >
                        {sendingOffSite
                          ? `Keep ${stageLabel(actionStage)} in the shop`
                          : `Send ${stageLabel(actionStage)} off-site instead`}
                      </Button>
                    )}
                    {canOverride &&
                      action === "check_in" &&
                      actionStage === "OFF_SITE" &&
                      (offSiteOptions?.plannedStages?.length || 0) > 0 && (
                        <Button type="button" variant="secondary" disabled={busy} onClick={keepInShop}>
                          Do{" "}
                          {(offSiteOptions?.plannedStages || []).map((st) => stageLabel(st)).join(", ")} in the shop
                          instead
                        </Button>
                      )}
                    {(codes.has("check_in") ||
                      codes.has("check_out") ||
                      codes.has("start_first") ||
                      codes.has("mark_ready") ||
                      codes.has("send_next")) &&
                      action !== "blocked" && (
                      <Button type="submit" form="scan-form" disabled={busy || (staffRequired && !staffId)}>
                        {busy ? "Working…" : actionLabel}
                      </Button>
                    )}
                    {canLabels && (
                      <Link to="/labels" className="text-center text-sm font-semibold text-accent">
                        Print / reprint label
                      </Link>
                    )}
                    {details.item?._id && (
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

              {(details.production?.assignmentChain || []).length > 0 && (
                <div className="border border-line bg-surface p-4">
                  <p className="text-sm font-semibold text-ink">Production path</p>
                  <ol className="mt-3 space-y-1.5 text-sm">
                    {(details.production?.assignmentChain || []).map((step, i) => (
                      <li key={`${step.stage}-${i}`} className="flex justify-between gap-2">
                        <span className="capitalize text-ink">
                          {step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : "○"}{" "}
                          {stageLabel(step.stage)}
                        </span>
                        <span className="text-ink-muted">{step.staff?.name || "—"}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {canOverride && details.item?._id && (
                <AssignmentChain
                  orderItemId={details.item._id}
                  scan={details}
                  onSaved={() => lookupBarcode(barcode)}
                />
              )}

              {canOverride && details.item?._id && !STAFF_OPTIONAL.includes(scanStage) && (
                <SuggestedAssignments
                  orderItemId={details.item._id}
                  stage={actionStage}
                  onAssigned={(id) => {
                    setStaffId(id);
                    lookupBarcode(barcode);
                  }}
                />
              )}

              {details.item?._id && (
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
