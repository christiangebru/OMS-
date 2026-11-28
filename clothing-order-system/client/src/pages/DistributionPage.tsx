import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { apiJson, describeApiError } from "@/lib/api";
import type { ProductionQueue, Staff } from "@/lib/types";
import { daysLabel, stageLabel } from "@/lib/format";
import { PageHeader, EmptyState, ErrorState, Skeleton } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useToast } from "@/context/ToastContext";
import clsx from "clsx";
import {
  byUrgency,
  canDo,
  groupBoard,
  nextStepOf,
  STATIONS,
  type BoardGroup
} from "@/lib/boardGroups";

/**
 * Assign: the garments that are with the manager (or not received yet) and
 * who should get each one next. Choosing a worker plans it; scanning the
 * garment is the hand-over.
 */
export function DistributionPage() {
  const { push } = useToast();
  const [board, setBoard] = useState<ProductionQueue | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<string>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const hydrated = useRef(false);

  const load = useCallback(async () => {
    try {
      const [data, workers] = await Promise.all([
        apiJson<ProductionQueue>("/api/production/queue"),
        apiJson<Staff[]>("/api/staff?includeInactive=false")
      ]);
      hydrated.current = true;
      setBoard(data);
      setStaff(workers);
      setErr(null);
    } catch (e) {
      if (!hydrated.current) setErr(describeApiError(e, "Could not load"));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, 20000);

  const waiting = board
    ? groupBoard(board.items)
        .filter((g) => g.place === "new" || g.place === "storage")
        .sort(byUrgency)
    : [];
  const steps = [...new Set(waiting.map(nextStepOf))];
  const shown = waiting.filter((g) => step === "ALL" || nextStepOf(g) === step);
  const needWorker = waiting.filter((g) => STATIONS.includes(nextStepOf(g)) && !assignedId(g)).length;

  async function assign(g: BoardGroup, staffId: string) {
    setBusy(g.key);
    try {
      const rec = g.rows.find((r) => r.recommended)?.recommended;
      for (const row of g.rows) {
        await apiJson("/api/production/assignments", {
          method: "POST",
          body: JSON.stringify({
            staffId,
            orderItemId: row.itemId,
            stage: row.nextStage,
            suggestedStaffId: rec?.staff._id || staffId,
            followedSuggestion: !rec || rec.staff._id === staffId
          })
        });
      }
      push(`${g.lead.customer?.name || g.code} → ${staff.find((s) => s._id === staffId)?.name || "worker"}`, "ok");
      setErr(null);
      await load();
    } catch (e) {
      setErr(describeApiError(e, "Could not assign"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title="Assign"
        description="Garments with you. Pick who gets each one next, then scan it to hand it over."
      />

      {err && <ErrorState message={err} />}

      {!board ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            <span className="font-semibold text-ink">{waiting.length}</span> with you ·{" "}
            <span className={clsx("font-semibold", needWorker ? "text-amber-800" : "text-ink")}>{needWorker}</span> need a
            worker
          </p>

          {steps.length > 1 && (
            <div className="flex flex-wrap gap-2" aria-label="Next step">
              {["ALL", ...steps].map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={step === st}
                  onClick={() => setStep(st)}
                  className={clsx(
                    "min-h-9 rounded-control border px-3 text-xs font-medium",
                    step === st ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink-muted"
                  )}
                >
                  {st === "ALL" ? "All" : stageLabel(st)}{" "}
                  <span className="tabular">
                    {st === "ALL" ? waiting.length : waiting.filter((g) => nextStepOf(g) === st).length}
                  </span>
                </button>
              ))}
            </div>
          )}

          {shown.length === 0 ? (
            <EmptyState title="Nothing waiting" body="Every garment is at a station or away." />
          ) : (
            <ul className="divide-y divide-line border border-line bg-surface">
              {shown.map((g) => (
                <AssignRow
                  key={g.key}
                  g={g}
                  staff={staff}
                  busy={busy === g.key}
                  value={choice[g.key]}
                  onChoose={(id) => setChoice((c) => ({ ...c, [g.key]: id }))}
                  onAssign={(id) => void assign(g, id)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function assignedId(g: BoardGroup) {
  const ids = [...new Set(g.rows.map((r) => r.assignment?.staff?._id).filter(Boolean))];
  return ids.length === 1 && g.rows.every((r) => r.assignment?.staff) ? (ids[0] as string) : "";
}

function AssignRow({
  g,
  staff,
  busy,
  value,
  onChoose,
  onAssign
}: {
  g: BoardGroup;
  staff: Staff[];
  busy: boolean;
  value?: string;
  onChoose: (id: string) => void;
  onAssign: (id: string) => void;
}) {
  const lead = g.lead;
  const next = nextStepOf(g);
  const station = STATIONS.includes(next);
  const current = assignedId(g);
  const suggested = g.rows.find((r) => r.recommended)?.recommended?.staff._id || "";
  const selected = value ?? (current || suggested);
  // The worker already assigned always shows, even without the skill on record.
  const eligible = staff
    .filter((s) => (s.active !== false && canDo(s, next)) || s._id === current)
    .sort(
      (a, b) =>
        Number(b._id === suggested) - Number(a._id === suggested) ||
        (a.activeAssignmentCount || 0) - (b.activeAssignmentCount || 0)
    );
  const scanCode = g.isParts ? g.rows[0].labelBarcode || g.rows[0].barcodeValue : g.code;

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <Link to={`/scan?barcode=${encodeURIComponent(scanCode)}`} className="min-w-0 flex-1 hover:text-accent">
        <p className="truncate font-semibold text-ink">
          {lead.customer?.name || "—"}
          {lead.priority !== "NORMAL" && <span className="ml-2 text-xs font-bold text-amber-800">{lead.priority}</span>}
        </p>
        <p className="truncate text-xs text-ink-muted">
          {g.title} · <span className="font-mono">{g.code}</span>
          {g.isParts && <span className="font-semibold"> · {g.rows.map((r) => r.partCode).join(" ")}</span>}
        </p>
        <p className={clsx("text-xs", lead.overdue ? "font-semibold text-red-700" : "text-ink-faint")}>
          {g.place === "new" ? "Not received yet · " : ""}
          {daysLabel(lead.daysRemaining, lead.overdue)}
        </p>
      </Link>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-xs text-ink-muted">Next: <span className="font-semibold text-ink">{stageLabel(next)}</span></span>
        {next === "OFF_SITE" ? (
          <Link
            to="/off-site"
            className="inline-flex min-h-9 items-center rounded-control bg-accent px-3 text-xs font-semibold text-white"
          >
            Send off-site
          </Link>
        ) : station ? (
          eligible.length ? (
            <>
              <select
                className="min-h-9 rounded-control border border-line bg-surface px-2 text-sm"
                value={selected}
                onChange={(e) => onChoose(e.target.value)}
                aria-label={`Worker for ${stageLabel(next)}`}
              >
                {!selected && <option value="">Choose…</option>}
                {eligible.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                    {s._id === current ? " (assigned)" : s._id === suggested ? " (suggested)" : ""}{!canDo(s, next) ? " · no skill" : ""} · {s.activeAssignmentCount || 0} in queue
                    {s.status === "OFF_DUTY" ? " · off" : ""}
                  </option>
                ))}
              </select>
              {current && current === selected ? (
                <span className="min-w-[72px] text-center text-xs font-semibold text-accent">✓ Assigned</span>
              ) : (
                <Button size="sm" disabled={!selected || busy} onClick={() => onAssign(selected)}>
                  {busy ? "…" : current ? "Change" : g.rows.length > 1 ? `Assign (${g.rows.length})` : "Assign"}
                </Button>
              )}
            </>
          ) : (
            <Link to="/staff" className="text-xs font-semibold text-red-700 underline">
              No one has the {stageLabel(next)} skill
            </Link>
          )
        ) : (
          <span className="text-xs text-ink-muted">Scan it to move it</span>
        )}
      </div>
    </li>
  );
}
