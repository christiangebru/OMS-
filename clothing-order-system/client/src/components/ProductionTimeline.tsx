import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { StageState, TimelineEntry } from "@/lib/types";
import { formatDate, formatDuration, stageLabel } from "@/lib/format";
import clsx from "clsx";

type Props = {
  orderItemId?: string;
  stages?: StageState[];
};

export function ProductionTimeline({ orderItemId, stages: stagesProp }: Props) {
  const [stages, setStages] = useState<StageState[]>(stagesProp || []);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(!stagesProp && Boolean(orderItemId));

  useEffect(() => {
    if (stagesProp) {
      setStages(stagesProp);
      return;
    }
    if (!orderItemId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson<{ stages?: StageState[]; timeline: TimelineEntry[] }>(
          `/api/order-items/${orderItemId}/timeline`
        );
        if (cancelled) return;
        if (data.stages?.length) setStages(data.stages);
        else {
          setStages(
            (data.timeline || []).map((e) => ({
              stage: e.stage,
              status: e.open ? "in_progress" : "completed",
              checkedInAt: e.checkedInAt,
              checkedOutAt: e.checkedOutAt,
              durationMs: e.durationMs,
              open: e.open,
              checkedInBy: e.checkedInBy,
              checkedOutBy: e.checkedOutBy
            }))
          );
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load timeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderItemId, stagesProp]);

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading production timeline…</p>;
  }
  if (err) return <p className="text-sm text-red-700">{err}</p>;
  if (!stages.length) {
    return (
      <p className="text-sm text-ink-muted">This garment has not entered production yet.</p>
    );
  }

  return (
    <ol className="space-y-0">
      {stages.map((st, i) => (
        <li key={st.stage} className="relative flex gap-3 pb-5 last:pb-0">
          {i < stages.length - 1 && (
            <span
              className={clsx(
                "absolute left-[9px] top-5 h-[calc(100%-8px)] w-px",
                st.status === "completed" ? "bg-accent" : "bg-line"
              )}
            />
          )}
          <span
            className={clsx(
              "relative z-10 mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
              st.status === "completed" && "border-accent bg-accent text-white",
              st.status === "in_progress" && "border-sky-600 bg-sky-600 text-white",
              st.status === "next" && "border-accent bg-surface text-accent",
              st.status === "waiting" && "border-line bg-surface text-ink-faint"
            )}
            aria-hidden
          >
            {st.status === "completed" ? "✓" : st.status === "in_progress" ? "●" : ""}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <p className="text-sm font-semibold capitalize text-ink">{stageLabel(st.stage)}</p>
              <span
                className={clsx(
                  "text-[11px] font-semibold uppercase tracking-wide",
                  st.status === "completed" && "text-accent",
                  st.status === "in_progress" && "text-sky-700",
                  st.status === "next" && "text-accent",
                  st.status === "waiting" && "text-ink-faint"
                )}
              >
                {st.status === "next" ? "Up next" : st.status.replace("_", " ")}
              </span>
            </div>
            {st.status === "completed" && (
              <p className="mt-0.5 text-xs text-ink-muted">
                {st.checkedOutBy?.name ? `Worker: ${st.checkedOutBy.name}` : st.checkedInBy?.name ? `Worker: ${st.checkedInBy.name}` : "Completed"}
                {st.durationMs != null ? ` · ${formatDuration(st.durationMs)}` : ""}
                {st.checkedOutAt ? ` · ${formatDate(st.checkedOutAt, true)}` : ""}
              </p>
            )}
            {st.status === "in_progress" && (
              <p className="mt-0.5 text-xs text-ink-muted">
                {st.checkedInBy?.name ? `Worker: ${st.checkedInBy.name}` : "In progress"}
                {st.checkedInAt ? ` · started ${formatDate(st.checkedInAt, true)}` : ""}
                {st.durationMs != null ? ` · ${formatDuration(st.durationMs)}` : ""}
              </p>
            )}
            {st.status === "waiting" || st.status === "next" ? (
              <p className="mt-0.5 text-xs text-ink-faint">Waiting</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
