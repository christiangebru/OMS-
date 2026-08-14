import clsx from "clsx";
import type { StaffStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: StaffStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        status === "AVAILABLE" && "bg-accent-soft text-accent",
        status === "BUSY" && "bg-amber-50 text-amber-800",
        status === "OFF_DUTY" && "bg-canvas text-ink-muted"
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
