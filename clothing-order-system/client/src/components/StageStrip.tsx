import clsx from "clsx";
import { stageLabel } from "@/lib/format";

export function StageStrip({
  stages,
  current,
  compact = false
}: {
  stages: string[];
  current?: string | null;
  compact?: boolean;
}) {
  const idx = Math.max(
    0,
    stages.findIndex((s) => s === current)
  );
  return (
    <ol className={clsx("flex items-start gap-0 overflow-x-auto", compact ? "py-0.5" : "py-1")}>
      {stages.map((stage, i) => {
        const done = i < idx;
        const here = i === idx || (!current && i === 0);
        return (
          <li key={stage} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-[4.5rem] flex-col items-center text-center">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  here && "bg-accent ring-4 ring-accent/20",
                  done && "bg-accent",
                  !here && !done && "bg-line-strong"
                )}
              />
              <span
                className={clsx(
                  "mt-1.5 capitalize leading-tight",
                  compact ? "text-[9px]" : "text-[10px]",
                  here ? "font-semibold text-ink" : done ? "text-ink-muted" : "text-ink-faint"
                )}
              >
                {stageLabel(stage)}
              </span>
            </div>
            {i < stages.length - 1 && (
              <span className={clsx("mb-4 h-px min-w-[8px] flex-1", i < idx ? "bg-accent/50" : "bg-line")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
