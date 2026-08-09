import { useEffect, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { TimelineEntry } from "@/lib/types";
import clsx from "clsx";

function formatDuration(ms?: number | null) {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

export function ProductionTimeline({ orderItemId }: { orderItemId: string }) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiJson<{ timeline: TimelineEntry[] }>(
          `/api/order-items/${orderItemId}/timeline`
        );
        if (!cancelled) setEntries(data.timeline || []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : "Failed to load timeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderItemId]);

  if (loading) return <p className="text-xs text-slate-500">Loading timeline…</p>;
  if (err) return <p className="text-xs text-red-600">{err}</p>;
  if (!entries.length) {
    return <p className="text-xs text-slate-500">No stage checkpoints yet.</p>;
  }

  return (
    <ol className="relative space-y-0 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
      {entries.map((e, i) => (
        <li key={e._id} className="relative pb-4">
          <span
            className={clsx(
              "absolute -left-[1.4rem] top-1 h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900",
              e.open ? "bg-amber-500" : "bg-emerald-500"
            )}
          />
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            {e.stage}{" "}
            {e.open && <span className="text-xs font-normal text-amber-600">in progress</span>}
          </div>
          <div className="text-xs text-slate-500">
            In: {String(e.checkedInAt).slice(0, 16).replace("T", " ")}
            {e.checkedInBy ? ` · ${e.checkedInBy.name}` : ""}
          </div>
          {e.checkedOutAt && (
            <div className="text-xs text-slate-500">
              Out: {String(e.checkedOutAt).slice(0, 16).replace("T", " ")}
              {e.checkedOutBy ? ` · ${e.checkedOutBy.name}` : ""} · {formatDuration(e.durationMs)}
            </div>
          )}
          {!e.checkedOutAt && e.open && (
            <div className="text-xs text-slate-500">Open · {formatDuration(e.durationMs)}</div>
          )}
          {i < entries.length - 1 && null}
        </li>
      ))}
    </ol>
  );
}
