export function shortOrderId(id?: string | null) {
  if (!id) return "—";
  if (/^ORD-\d+$/i.test(id)) return id.toUpperCase();
  const tail = id.replace(/^ORD-/i, "").replace(/-/g, "");
  return `ORD-${tail.slice(-4).toUpperCase()}`;
}

/** Printed / spoken garment barcode. Never a UUID, CUID, or ITM-* blob. */
export function labelBarcode(orderId?: string | null, index = 1, stored?: string | null) {
  const n = Math.max(1, Number(index) || 1);
  if (stored && /^ORD-\d+-\d+$/i.test(stored)) return stored.toUpperCase();
  const seq = String(orderId || "").match(/^ORD-(\d+)$/i);
  if (seq) return `ORD-${seq[1]}-${n}`;
  const digits = String(orderId || "").replace(/\D/g, "").slice(-4);
  if (digits) return `ORD-${Number(digits)}-${n}`;
  return `${shortOrderId(orderId)}-${n}`;
}

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
