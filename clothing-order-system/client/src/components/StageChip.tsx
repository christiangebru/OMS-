import clsx from "clsx";
import type { ProductionStage } from "@/lib/types";

type Props = {
  stage: ProductionStage | string;
  selected?: boolean;
  onClick?: () => void;
  size?: "sm" | "lg";
};

export function StageChip({ stage, selected, onClick, size = "sm" }: Props) {
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center rounded-xl font-semibold transition",
        size === "lg" ? "min-h-[48px] px-4 py-3 text-sm" : "px-2.5 py-1 text-xs",
        selected
          ? "bg-brand-600 text-white shadow"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
        onClick && "cursor-pointer"
      )}
    >
      {stage}
    </Comp>
  );
}
