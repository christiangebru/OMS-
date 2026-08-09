import { FormEvent, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, ScanDetails, Staff } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { StageChip } from "@/components/StageChip";
import { ScanDetailCard } from "@/components/ScanDetailCard";
import { SuggestedAssignments } from "@/components/SuggestedAssignments";
import { useAuth } from "@/context/AuthContext";
import clsx from "clsx";

export function ScanPage() {
  const { user } = useAuth();
  const [barcode, setBarcode] = useState("");
  const [stage, setStage] = useState<ProductionStage>("RECEIVED");
  const [staffId, setStaffId] = useState("");
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [adminOverride, setAdminOverride] = useState(false);
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState<ScanDetails | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef("");

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ stage, status: "AVAILABLE" });
        const data = await apiJson<Staff[]>(`/api/staff?${qs}`);
        if (!cancelled) {
          setStaffList(data);
          if (staffId && !data.some((s) => s._id === staffId)) {
            // keep selection even if not AVAILABLE (for checkout) — reload without status
          }
        }
      } catch {
        if (!cancelled) setStaffList([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  // Also load skilled staff regardless of status for checkout flexibility
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiJson<Staff[]>(
          `/api/staff?stage=${encodeURIComponent(stage)}&includeInactive=false`
        );
        if (!cancelled) {
          setStaffList((prev) => {
            const map = new Map(prev.map((s) => [s._id, s]));
            data.forEach((s) => map.set(s._id, s));
            return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
          });
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stage]);

  async function lookupBarcode(value: string) {
    const v = value.trim();
    if (!v) return;
    try {
      const data = await apiJson<{ scanDetails: ScanDetails }>(
        `/api/production/lookup?barcodeValue=${encodeURIComponent(v)}`
      );
      setDetails(data.scanDetails);
      if (data.scanDetails.timing.nextExpectedStage) {
        setStage(data.scanDetails.timing.nextExpectedStage);
      }
      setFeedback(null);
    } catch (e) {
      setDetails(null);
      setFeedback({
        ok: false,
        message: e instanceof ApiError ? e.message : "Lookup failed"
      });
    }
  }

  async function stopCamera() {
    try {
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
      }
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
      const scanner = new Html5Qrcode("scan-reader");
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 8, qrbox: { width: 280, height: 160 } },
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
    if (!barcode.trim() || !staffId || !stage) return;
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
          stage,
          staffId,
          notes,
          adminOverride
        })
      });
      setFeedback({ ok: true, message: result.message });
      setDetails(result.scanDetails);
      if (result.scanDetails.timing.nextExpectedStage) {
        setStage(result.scanDetails.timing.nextExpectedStage);
      }
      lastScanRef.current = "";
    } catch (ex) {
      setFeedback({
        ok: false,
        message: ex instanceof ApiError ? ex.message : "Scan failed"
      });
      // Still try to show details if barcode known
      if (barcode.trim()) await lookupBarcode(barcode);
    } finally {
      setBusy(false);
    }
  }

  const canOverride = user?.role === "admin" || user?.role === "manager";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Scan floor</h1>
        <p className="text-sm text-slate-500">
          Check items in and out of production stages. Big targets, minimal clicks.
        </p>
      </div>

      {feedback && (
        <div
          className={clsx(
            "rounded-2xl px-4 py-4 text-center text-lg font-bold",
            feedback.ok
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
              : "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
          )}
          role="status"
        >
          {feedback.ok ? "PASS" : "FAIL"} — {feedback.message}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div>
          <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="barcode">
            Item barcode
          </label>
          <input
            id="barcode"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onBlur={() => lookupBarcode(barcode)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-4 text-xl font-mono dark:border-slate-700 dark:bg-slate-950"
            placeholder="ITM-…"
            autoComplete="off"
            autoFocus
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => lookupBarcode(barcode)}
              className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold dark:border-slate-600"
            >
              Lookup
            </button>
            {!cameraOn ? (
              <button
                type="button"
                onClick={startCamera}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white dark:bg-brand-600"
              >
                Start camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="rounded-xl border border-red-200 px-4 py-3 text-sm font-semibold text-red-700"
              >
                Stop camera
              </button>
            )}
          </div>
          <div id="scan-reader" className={clsx("mt-3 overflow-hidden rounded-xl", !cameraOn && "hidden")} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Target stage</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PRODUCTION_STAGES.map((s) => (
              <StageChip
                key={s}
                stage={s}
                size="lg"
                selected={stage === s}
                onClick={() => setStage(s)}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="staff">
            Staff
          </label>
          <select
            id="staff"
            required
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-4 text-base dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">Select staff…</option>
            {staffList.map((s) => (
              <option key={s._id} value={s._id}>
                {s.name} ({s.status}) — {s.role}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase text-slate-500" htmlFor="notes">
            Notes (optional)
          </label>
          <input
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </div>

        {canOverride && (
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={adminOverride}
              onChange={(e) => setAdminOverride(e.target.checked)}
              className="h-5 w-5"
            />
            Admin override stage sequence
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !barcode.trim() || !staffId}
          className="w-full rounded-2xl bg-brand-600 py-5 text-xl font-bold text-white shadow hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "Working…" : "Scan / Check-in · Check-out"}
        </button>
      </form>

      {details && (
        <>
          <ScanDetailCard details={details} />
          <SuggestedAssignments
            orderItemId={details.item._id}
            stage={stage}
            onAssigned={(id) => {
              setStaffId(id);
              setFeedback({
                ok: true,
                message: "Staff assigned — confirm with Scan button to check in"
              });
            }}
          />
        </>
      )}
    </div>
  );
}
