import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, ScanDetails, Staff } from "@/lib/types";
import { ScanDetailCard } from "@/components/ScanDetailCard";
import { SuggestedAssignments } from "@/components/SuggestedAssignments";
import { useAuth } from "@/context/AuthContext";
import { isManagerRole } from "@/lib/roles";
import { stageLabel } from "@/lib/format";
import { PageHeader, ErrorState } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import clsx from "clsx";

type Recent = { barcode: string; at: number; label: string; ok: boolean };

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
  const [cameraOn, setCameraOn] = useState(false);
  const [recent, setRecent] = useState<Recent[]>([]);
  const scannerRef = useRef<{
    isScanning?: boolean;
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);
  const lastScanRef = useRef("");

  const action = details?.production?.action;
  const actionStage = (details?.production?.actionStage ||
    details?.timing.nextExpectedStage ||
    "RECEIVED") as ProductionStage;
  const canOverride = isManagerRole(user?.role);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    const fromUrl = searchParams.get("barcode");
    if (fromUrl) {
      setBarcode(fromUrl);
      lookupBarcode(fromUrl);
    }
    // lookupBarcode is stable enough for mount / barcode param changes
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
          const assigned = details?.production?.assignment?.staff?._id;
          if (assigned && data.some((s) => s._id === assigned)) {
            setStaffId(assigned);
          }
        }
      } catch {
        if (!cancelled) setStaffList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [actionStage, details?.production?.assignment?.staff?._id]);

  async function lookupBarcode(value: string) {
    const v = value.trim();
    if (!v) return;
    try {
      const data = await apiJson<{ scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      setDetails(data.scanDetails);
      setFeedback(null);
      const assigned = data.scanDetails.production?.assignment?.staff?._id;
      if (assigned) setStaffId(assigned);
      setRecent((prev) => {
        if (prev[0]?.barcode === v && prev[0]?.ok) return prev;
        return [
          {
            barcode: v,
            at: Date.now(),
            label: `${data.scanDetails.item.clothingType} · ${data.scanDetails.customer?.name || "lookup"}`,
            ok: true
          },
          ...prev
        ].slice(0, 8);
      });
    } catch (e) {
      setDetails(null);
      setFeedback({
        ok: false,
        message: e instanceof ApiError ? e.message : "No item found for that barcode"
      });
    }
  }

  async function stopCamera() {
    try {
      if (scannerRef.current?.isScanning) await scannerRef.current.stop();
      scannerRef.current?.clear();
    } catch {
      /* ignore */
    }
    scannerRef.current = null;
    setCameraOn(false);
  }

  async function startCamera() {
    setFeedback(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("scan-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 320, height: 200 } },
        (decoded) => {
          if (decoded && decoded !== lastScanRef.current) {
            lastScanRef.current = decoded;
            setBarcode(decoded);
            lookupBarcode(decoded);
          }
        },
        () => {}
      );
      setCameraOn(true);
    } catch (e) {
      setFeedback({
        ok: false,
        message: e instanceof Error ? e.message : "Could not start camera"
      });
      setCameraOn(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!barcode.trim() || !staffId) return;
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
      setRecent((prev) => [
        {
          barcode: barcode.trim(),
          at: Date.now(),
          label: `${result.scanDetails.item.clothingType} · ${result.message}`,
          ok: true
        },
        ...prev
      ].slice(0, 8));
      lastScanRef.current = "";
      setNotes("");
    } catch (ex) {
      const message = ex instanceof ApiError ? ex.message : "Scan failed";
      setFeedback({ ok: false, message });
      setRecent((prev) =>
        [
          { barcode: barcode.trim(), at: Date.now(), label: message, ok: false },
          ...prev
        ].slice(0, 8)
      );
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
      setFeedback({
        ok: false,
        message: e instanceof ApiError ? e.message : "Could not mark received"
      });
    } finally {
      setBusy(false);
    }
  }

  const actionLabel =
    action === "check_out"
      ? `Check out of ${stageLabel(actionStage)}`
      : `Check in to ${stageLabel(actionStage)}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Production floor"
        description="Scan a garment barcode to check it in or out of the current stage."
      />

      {feedback && (
        <div
          className={clsx(
            "rounded-xl px-4 py-3 text-center text-base font-semibold",
            feedback.ok ? "bg-accent-soft text-accent" : "bg-red-50 text-red-800"
          )}
          role="status"
        >
          {feedback.ok ? "Recorded" : "Cannot proceed"} — {feedback.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form id="scan-form" onSubmit={onSubmit} className="space-y-4">
          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <p className="text-sm font-semibold text-ink">Scanner</p>
              {!cameraOn ? (
                <Button type="button" size="sm" onClick={startCamera}>
                  Start camera
                </Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={stopCamera}>
                  Stop camera
                </Button>
              )}
            </div>
            <div
              id="scan-reader"
              className={clsx(
                "relative min-h-[280px] bg-ink sm:min-h-[360px]",
                !cameraOn && "flex items-center justify-center"
              )}
            >
              {!cameraOn && (
                <p className="px-6 text-center text-sm text-white/70">
                  Start the camera or enter a barcode below. Hold the item label in the frame.
                </p>
              )}
            </div>
            <div className="border-t border-line p-4">
              <label className="ui-label" htmlFor="barcode">
                Item barcode
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
                  placeholder="ITM-…"
                  autoComplete="off"
                  autoFocus
                />
                <Button type="button" variant="secondary" onClick={() => lookupBarcode(barcode)}>
                  Lookup
                </Button>
              </div>
            </div>
          </div>

          {details && (
            <div className="ui-card p-4">
              <p className="text-lg font-semibold text-ink">
                {details.item.clothingType}
                <span className="ml-2 font-mono text-sm font-normal text-ink-muted">
                  {details.item.barcodeValue}
                </span>
              </p>
              <p className="text-sm text-ink-muted">
                {details.customer?.name || "—"} · {stageLabel(details.timing.currentStage || actionStage)}
                {details.production?.assignment?.staff?.name
                  ? ` · ${details.production.assignment.staff.name}`
                  : " · unassigned"}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Next: {action === "check_out" ? "Check out" : "Check in"} {stageLabel(actionStage)}
                {details.timing.overdue ? " · overdue" : ""}
              </p>
            </div>
          )}

          <div className="ui-card space-y-4 p-4">
            <div>
              <label className="ui-label" htmlFor="staff">
                Worker
              </label>
              <select
                id="staff"
                required
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                className="ui-input"
              >
                <option value="">Select worker…</option>
                {staffList.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name} · {s.status.replace("_", " ")} · {s.role}
                  </option>
                ))}
              </select>
              {!staffList.length && (
                <p className="mt-1 text-xs text-ink-muted">
                  No skilled workers for {stageLabel(actionStage)}.
                </p>
              )}
            </div>
            <div>
              <label className="ui-label" htmlFor="notes">
                Notes
              </label>
              <input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="ui-input"
                placeholder="Optional"
              />
            </div>
            {canOverride && (
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={adminOverride}
                  onChange={(e) => setAdminOverride(e.target.checked)}
                  className="h-4 w-4 accent-accent"
                />
                Override stage sequence (manager)
              </label>
            )}
                {details?.production?.assignment?.distributedAt &&
              !details.production.assignment.receivedAt && (
                <Button
                  type="button"
                  size="lg"
                  variant="secondary"
                  className="min-h-12 w-full max-sm:hidden"
                  disabled={busy}
                  onClick={receiveAssignment}
                >
                  Confirm received
                </Button>
              )}
            <Button
              type="submit"
              size="lg"
              className="min-h-14 w-full text-base max-sm:hidden"
              disabled={busy || !barcode.trim() || !staffId || !details}
            >
              {busy ? "Working…" : details ? actionLabel : "Scan an item first"}
            </Button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="ui-card p-4">
            <p className="text-sm font-semibold text-ink">This scan</p>
            {details ? (
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Stage</dt>
                  <dd className="capitalize font-medium">{stageLabel(actionStage)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Action</dt>
                  <dd className="font-medium">{action === "check_out" ? "Check out" : "Check in"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-muted">Due</dt>
                  <dd className={details.timing.overdue ? "font-semibold text-red-700" : ""}>
                    {details.timing.overdue ? "Overdue" : "On time"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Waiting for a barcode.</p>
            )}
          </div>
          <div className="ui-card p-4">
            <p className="text-sm font-semibold text-ink">Recent scans</p>
            {recent.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">None yet this session.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recent.map((r) => (
                  <li key={`${r.barcode}-${r.at}`}>
                    <button
                      type="button"
                      className="w-full text-left text-xs"
                      onClick={() => {
                        setBarcode(r.barcode);
                        lookupBarcode(r.barcode);
                      }}
                    >
                      <span className="font-mono text-ink">{r.barcode}</span>
                      <span className={clsx("mt-0.5 block", r.ok ? "text-ink-muted" : "text-red-700")}>
                        {r.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
        {details?.production?.assignment?.distributedAt && !details.production.assignment.receivedAt ? (
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="mb-2 min-h-12 w-full"
            disabled={busy}
            onClick={receiveAssignment}
          >
            Confirm received
          </Button>
        ) : null}
        <Button
          type="submit"
          form="scan-form"
          size="lg"
          className="min-h-14 w-full text-base"
          disabled={busy || !barcode.trim() || !staffId || !details}
        >
          {busy ? "Working…" : details ? actionLabel : "Scan an item first"}
        </Button>
      </div>
      <div className="h-24 sm:hidden" aria-hidden />

      {feedback && !feedback.ok && <ErrorState message={feedback.message} />}

      {details && (
        <>
          <ScanDetailCard details={details} />
          {canOverride && details.item._id && (
            <SuggestedAssignments
              orderItemId={details.item._id}
              stage={actionStage}
              onAssigned={(id) => {
                setStaffId(id);
                setFeedback({
                  ok: true,
                  message: "Worker assigned. Confirm check-in when the garment is in their hands."
                });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
