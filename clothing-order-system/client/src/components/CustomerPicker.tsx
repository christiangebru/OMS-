import { useEffect, useRef, useState } from "react";
import { apiJson, ApiError } from "@/lib/api";
import type { Customer, Measurement } from "@/lib/types";

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
        const data = await apiJson<Customer[]>(
          `/api/customers?q=${encodeURIComponent(q.trim())}`
        );
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
        body: JSON.stringify({ name: newName, phone: newPhone })
      });
      await pick(created);
      setNewName("");
      setNewPhone("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not create customer");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative space-y-3 sm:col-span-2">
      <div>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="cust-search">
          Find customer
        </label>
        <input
          id="cust-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search by name or phone…"
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          autoComplete="off"
        />
        {open && results.length > 0 && (
          <ul className="absolute z-20 mt-1 max-h-48 w-full max-w-lg overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {results.map((c) => (
              <li key={c._id}>
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => pick(c)}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.phone}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {customerId ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">{customerName}</p>
            <p className="text-xs text-slate-500">{customerPhone}</p>
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-semibold text-brand-600 hover:underline"
            >
              Change
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="cust-name">
              Customer name
            </label>
            <input
              id="cust-name"
              required={!customerId}
              value={customerName}
              onChange={(e) => onNamePhoneChange?.(e.target.value, customerPhone)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="cust-phone">
              Customer phone
            </label>
            <input
              id="cust-phone"
              required={!customerId}
              value={customerPhone}
              onChange={(e) => onNamePhoneChange?.(customerName, e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowNew((v) => !v)}
          className="text-xs font-semibold text-brand-600 hover:underline"
        >
          {showNew ? "Hide new customer form" : "Add new customer"}
        </button>
        {showNew && (
          <div className="mt-2 grid gap-3 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-3 dark:border-slate-600">
            <input
              placeholder="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              placeholder="Phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <button
              type="button"
              disabled={saving || !newName.trim() || !newPhone.trim()}
              onClick={createCustomer}
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Create & select"}
            </button>
          </div>
        )}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
