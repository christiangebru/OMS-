import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, StaffRanking } from "@/lib/types";

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

  if (loading) {
    return <p className="text-sm text-slate-500">Loading suggestions…</p>;
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
        Suggested assignments — {stage}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Manager confirms — nothing is auto-assigned.
      </p>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {!rankings.length && (
        <p className="mt-3 text-sm text-slate-500">No eligible staff for this stage.</p>
      )}
      <ul className="mt-3 space-y-2">
        {rankings.slice(0, 8).map((r, idx) => (
          <li
            key={r.staff._id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60"
          >
            <div>
              <p className="text-sm font-semibold">
                {idx === 0 ? "★ " : ""}
                {r.staff.name}{" "}
                <span className="text-xs font-normal text-slate-500">
                  skill {r.staff.skillLevel} · score {r.scores.rankedScore.toFixed(2)}
                </span>
              </p>
              <p className="text-xs text-slate-500">{r.reason}</p>
            </div>
            <button
              type="button"
              disabled={busyId === r.staff._id}
              onClick={() => assign(r, idx === 0)}
              className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              Assign to {r.staff.name.split(" ")[0]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
