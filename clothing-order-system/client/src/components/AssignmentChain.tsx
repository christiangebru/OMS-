import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, ScanDetails, Staff } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { stageLabel } from "@/lib/format";
import { Button } from "@/components/ui/Button";

type PathStep = { stage: ProductionStage; staffId: string };

export function AssignmentChain({
  orderItemId,
  scan,
  onSaved
}: {
  orderItemId: string;
  scan?: ScanDetails | null;
  onSaved?: () => void;
}) {
  const sequence = (scan?.timing.stageSequence || PRODUCTION_STAGES).filter(
    (s) => !["DELIVERED"].includes(s)
  ) as ProductionStage[];
  const [staffByStage, setStaffByStage] = useState<Record<string, Staff[]>>({});
  const [path, setPath] = useState<PathStep[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial: PathStep[] = sequence.map((stage) => {
      const existing = scan?.production?.assignmentChain?.find((s) => s.stage === stage);
      return { stage, staffId: existing?.staff?._id || "" };
    });
    setPath(initial);
  }, [orderItemId, scan?.item?._id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, Staff[]> = {};
      await Promise.all(
        sequence.map(async (stage) => {
          try {
            next[stage] = await apiJson<Staff[]>(`/api/staff?stage=${encodeURIComponent(stage)}&includeInactive=false`);
          } catch {
            next[stage] = [];
          }
        })
      );
      if (!cancelled) setStaffByStage(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [orderItemId, sequence.join(",")]);

  async function save() {
    const filled = path.filter((p) => p.staffId);
    if (!filled.length) return;
    setBusy(true);
    setErr(null);
    try {
      await apiJson("/api/production/assignment-chain", {
        method: "POST",
        body: JSON.stringify({ orderItemId, path: filled })
      });
      onSaved?.();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save assignment path");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">Production assignment path</h3>
      <p className="mt-0.5 text-xs text-ink-muted">
        Assign the full chain. Workers can already have other queued orders — assigned is not busy.
      </p>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      <ol className="mt-3 space-y-2">
        {path.map((step, i) => (
          <li key={step.stage} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-2 text-sm">
            <span className="capitalize text-ink-muted">
              {i + 1}. {stageLabel(step.stage)}
            </span>
            <select
              className="ui-input mt-0"
              value={step.staffId}
              onChange={(e) =>
                setPath((list) => list.map((row) => (row.stage === step.stage ? { ...row, staffId: e.target.value } : row)))
              }
            >
              <option value="">Unassigned</option>
              {(staffByStage[step.stage] || []).map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} · {s.activeAssignmentCount || 0} queued
                </option>
              ))}
            </select>
          </li>
        ))}
      </ol>
      <Button type="button" className="mt-3" disabled={busy} onClick={save}>
        {busy ? "Saving…" : "Save path"}
      </Button>
    </div>
  );
}
