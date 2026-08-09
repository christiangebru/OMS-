import clsx from "clsx";
import type { StaffStatus } from "@/lib/types";

export function StatusBadge({ status }: { status: StaffStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        status === "AVAILABLE" &&
          "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
        status === "BUSY" &&
          "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100",
        status === "OFF_DUTY" &&
          "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
