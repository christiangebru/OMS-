import clsx from "clsx";
import type { ProductionStage } from "@/lib/types";
import { stageLabel } from "@/lib/format";

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
        "inline-flex items-center justify-center rounded-control font-semibold capitalize transition",
        size === "lg" ? "min-h-[48px] px-4 py-3 text-sm" : "px-2.5 py-1 text-xs",
        selected ? "bg-accent text-white" : "bg-canvas text-ink-muted hover:bg-accent-soft hover:text-accent",
        onClick && "cursor-pointer"
      )}
    >
      {stageLabel(String(stage))}
    </Comp>
  );
}
