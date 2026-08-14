import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, StaffRanking } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/PageHeader";

type Props = {
  orderItemId: string;
  stage: ProductionStage;
  onAssigned: (staffId: string, followedSuggestion: boolean, suggestedStaffId: string | null) => void;
};

export function SuggestedAssignments({ orderItemId, stage, onAssigned }: Props) {
  const [rankings, setRankings] = useState<StaffRanking[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const data = await apiJson<{ rankings: StaffRanking[] }>(
          `/api/production/suggest-assignment?orderItemId=${encodeURIComponent(orderItemId)}&stage=${encodeURIComponent(stage)}`
        );
        if (!cancelled) setRankings(data.rankings || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load suggestions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderItemId, stage]);

  async function assign(r: StaffRanking, followed: boolean) {
    setBusyId(r.staff._id);
    setErr(null);
    const topId = rankings[0]?.staff._id || null;
    try {
      await apiJson("/api/production/assignments", {
        method: "POST",
        body: JSON.stringify({
          staffId: r.staff._id,
          orderItemId,
          stage,
          suggestedStaffId: topId,
          followedSuggestion: followed
        })
      });
      onAssigned(r.staff._id, followed, topId);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Assign failed");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading worker recommendations…</p>;

  return (
    <div className="ui-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Recommended workers</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            Scoring uses skill, availability, workload, priority, and due date. Nothing is auto-assigned.
          </p>
        </div>
        <Badge tone="neutral">{stage}</Badge>
      </div>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {!rankings.length && (
        <p className="mt-3 text-sm text-ink-muted">No eligible staff for this stage.</p>
      )}
      <ul className="mt-4 space-y-3">
        {rankings.slice(0, 6).map((r, idx) => (
          <li key={r.staff._id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-canvas px-3 py-3">
            <div>
              <p className="text-sm font-semibold text-ink">
                {idx === 0 ? "Recommended · " : ""}
                {r.staff.name}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  skill {r.staff.skillLevel}/5 · {r.staff.activeAssignmentCount} active
                </span>
              </p>
              {r.summary && <p className="mt-1 text-xs text-ink-muted">{r.summary}</p>}
              <ul className="mt-1 space-y-0.5 text-[12px]">
                {(r.reasons || [{ ok: true, code: "reason", label: r.reason }]).map((reason) => (
                  <li key={reason.code + reason.label} className={reason.ok ? "text-accent" : "text-ink-muted"}>
                    {reason.ok ? "✓" : "–"} {reason.label}
                  </li>
                ))}
              </ul>
            </div>
            <Button
              type="button"
              size="sm"
              variant={idx === 0 ? "primary" : "secondary"}
              disabled={busyId === r.staff._id}
              onClick={() => assign(r, idx === 0)}
            >
              {idx === 0 ? "Accept" : "Assign"}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
