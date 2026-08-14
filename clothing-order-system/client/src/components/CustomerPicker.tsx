import { useEffect, useRef, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { Customer, Measurement } from "@/lib/types";
import { Button } from "@/components/ui/Button";

type Props = {
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  onSelect: (customer: Customer, latestMeasurement?: Measurement | null) => void;
  onClear?: () => void;
  onNamePhoneChange?: (name: string, phone: string) => void;
};

export function CustomerPicker({
  customerId,
  customerName,
  customerPhone,
  onSelect,
  onClear,
  onNamePhoneChange
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await apiJson<Customer[]>(`/api/customers?q=${encodeURIComponent(q.trim())}`);
        if (!cancelled) {
          setResults(data);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  async function pick(c: Customer) {
    setErr(null);
    try {
      const detail = await apiJson<Customer>(`/api/customers/${c._id}`);
      const latest = detail.measurements?.[0] || null;
      onSelect(detail, latest);
      setQ("");
      setOpen(false);
      setShowNew(false);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load customer");
    }
  }

  async function createCustomer() {
    setSaving(true);
    setErr(null);
    try {
      const created = await apiJson<Customer>("/api/customers", {
        method: "POST",
        body: JSON.stringify({ name: newName, phone: newPhone, email: newEmail })
      });
      await pick(created);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative space-y-4">
      <div>
        <label className="ui-label" htmlFor="cust-search">
          Find existing customer
        </label>
        <input
          id="cust-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search by name, phone, or email…"
          className="ui-input"
          autoComplete="off"
        />
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-card">
            {results.map((c) => (
              <li key={c._id}>
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-canvas"
                  onClick={() => pick(c)}
                >
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-ink-muted">
                    {c.phone}
                    {c.email ? ` · ${c.email}` : ""}
                    {typeof c.orderCount === "number" ? ` · ${c.orderCount} orders` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {customerId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-3">
          <div>
            <p className="text-sm font-semibold text-ink">{customerName}</p>
            <p className="text-xs text-ink-muted">{customerPhone}</p>
          </div>
          {onClear && (
            <Button type="button" size="sm" variant="secondary" onClick={onClear}>
              Change
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="ui-label" htmlFor="cust-name">
              New customer name
            </label>
            <input
              id="cust-name"
              required={!customerId}
              value={customerName}
              onChange={(e) => onNamePhoneChange?.(e.target.value, customerPhone)}
              className="ui-input"
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="cust-phone">
              Phone
            </label>
            <input
              id="cust-phone"
              required={!customerId}
              value={customerPhone}
              onChange={(e) => onNamePhoneChange?.(customerName, e.target.value)}
              className="ui-input"
            />
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="text-xs font-semibold text-accent hover:underline"
        >
          {showNew ? "Hide new customer form" : "Create customer first"}
        </button>
        {showNew && (
          <div className="mt-2 grid gap-3 rounded-lg border border-dashed border-line p-3 sm:grid-cols-4">
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="ui-input mt-0"
            />
            <input
              placeholder="Phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="ui-input mt-0"
            />
            <input
              placeholder="Email (optional)"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="ui-input mt-0"
            />
            <Button type="button" disabled={saving || !newName.trim() || !newPhone.trim()} onClick={createCustomer}>
              {saving ? "Saving…" : "Create & select"}
            </Button>
          </div>
        )}
      </div>
      {err && <p className="text-xs text-red-700">{err}</p>}
    </div>
  );
}
