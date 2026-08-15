export function formatDuration(ms?: number | null) {
  if (ms == null || Number.isNaN(ms)) return "—";
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatDate(value?: string | Date | null, withTime = false) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return withTime
    ? d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatMoney(n?: number | null) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function daysLabel(daysRemaining?: number | null, overdue?: boolean) {
  if (daysRemaining == null) return "—";
  if (overdue || daysRemaining < 0) return `${Math.abs(Math.ceil(daysRemaining))}d overdue`;
  if (daysRemaining < 1) return "Due today";
  return `${Math.ceil(daysRemaining)}d left`;
}

export function boardStatusLabel(status?: string | null) {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "assigned":
      return "Assigned";
    case "distributed":
    case "handed_over":
      return "Handed over";
    case "received":
      return "Received";
    case "in_progress":
      return "Checked in";
    case "idle":
      return "Available";
    default:
      return status || "—";
  }
}

export function stageLabel(stage: string) {
  return String(stage || "")
    .toLowerCase()
    .replace(/_/g, " ");
}

export function handoverLabel(status?: string | null) {
  switch (status) {
    case "assigned":
      return "Assigned";
    case "handed_over":
      return "Handed over";
    case "received":
      return "Received";
    default:
      return null;
  }
}
