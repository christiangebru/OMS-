import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { StageState, TimelineEntry } from "@/lib/types";
import { formatDate, formatDuration, stageLabel } from "@/lib/format";
import clsx from "clsx";

type Props = {
  orderItemId?: string;
  stages?: StageState[];
};

const STATUS_COPY: Record<StageState["status"], string> = {
  completed: "Done",
  in_progress: "Active",
  next: "Up next",
  waiting: "Waiting",
  skipped: "Skipped",
  blocked: "Blocked"
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
    return <p className="text-sm text-ink-muted">This garment has not entered production yet.</p>;
  }

  return (
    <ol className="space-y-0">
      {stages.map((st, i) => {
        const worker = st.assignedTo || st.checkedOutBy?.name || st.checkedInBy?.name;
        return (
          <li key={st.stage} className="flex gap-3">
            <div className="flex w-4 flex-col items-center">
              <span
                className={clsx(
                  "mt-1 h-2.5 w-2.5 rounded-full",
                  st.status === "in_progress" && "bg-accent ring-4 ring-accent/20",
                  st.status === "completed" && "bg-accent",
                  st.status === "next" && "bg-accent/40",
                  (st.status === "waiting" || st.status === "skipped") && "bg-line-strong",
                  (st.status === "blocked" || st.overdue) && "bg-red-600"
                )}
              />
              {i < stages.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>
            <div
              className={clsx(
                "mb-4 min-w-0 flex-1 border border-line bg-surface px-3 py-2.5",
                st.status === "in_progress" && "border-accent",
                (st.status === "blocked" || st.overdue) && "border-red-200 bg-red-50"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold capitalize text-ink">{stageLabel(st.stage)}</p>
                <p
                  className={clsx(
                    "text-xs font-medium capitalize",
                    st.status === "in_progress" && "text-accent",
                    (st.status === "blocked" || st.overdue) && "text-red-800",
                    st.status !== "in_progress" && !st.overdue && "text-ink-muted"
                  )}
                >
                  {st.overdue && st.status === "in_progress" ? "Overdue" : STATUS_COPY[st.status]}
                </p>
              </div>
              {st.assigned && (worker || st.handoverStatus) && (
                <p className="mt-1 truncate text-xs text-ink">
                  {worker || "Assigned"}
                  {st.handoverStatus === "handed_over"
                    ? " · handed over"
                    : st.handoverStatus === "received"
                      ? " · received"
                      : st.handoverStatus === "assigned"
                        ? " · assigned"
                        : ""}
                </p>
              )}
              {!st.assigned && worker && st.status !== "skipped" && (
                <p className="mt-1 truncate text-xs text-ink-muted">{worker}</p>
              )}
              {st.status === "completed" && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  {st.durationMs != null ? formatDuration(st.durationMs) : "Done"}
                  {st.checkedOutAt ? ` · ${formatDate(st.checkedOutAt, true)}` : ""}
                </p>
              )}
              {st.status === "in_progress" && (
                <p className="mt-1 text-[11px] text-ink-muted">
                  Started {st.checkedInAt ? formatDate(st.checkedInAt, true) : "—"}
                  {st.durationMs != null ? ` · ${formatDuration(st.durationMs)}` : ""}
                </p>
              )}
              {(st.status === "waiting" || st.status === "next" || st.status === "blocked") && (
                <p className="mt-1 text-[11px] text-ink-faint">
                  {st.waitingMs != null && st.waitingMs > 0
                    ? `Waiting ${formatDuration(st.waitingMs)}`
                    : st.status === "blocked"
                      ? "Past due"
                      : "Waiting"}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
