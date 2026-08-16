import clsx from "clsx";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-[1.375rem]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ui-card px-6 py-12 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Could not load this view",
  message,
  onRetry
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-control border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {onRetry && (
        <button type="button" className="mt-2 font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-control bg-line/70", className)} />;
}

export function Badge({
  children,
  tone = "neutral"
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "urgent" | "progress" | "accent";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        tone === "neutral" && "bg-canvas text-ink-muted",
        tone === "ok" && "bg-accent-soft text-accent",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "urgent" && "bg-red-50 text-red-800",
        tone === "progress" && "bg-accent-soft text-ink",
        tone === "accent" && "bg-accent text-white"
      )}
    >
      {children}
    </span>
  );
}
