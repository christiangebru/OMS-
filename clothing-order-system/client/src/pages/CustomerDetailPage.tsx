import { FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { Customer, Measurement } from "@/lib/types";

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    chest: "",
    waist: "",
    hip: "",
    shoulder: "",
    sleeveLength: "",
    inseam: "",
    neck: "",
    notes: ""
  });

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const data = await apiJson<Customer>(`/api/customers/${id}`);
      setCustomer(data);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function onAddMeasurement(e: FormEvent) {
    e.preventDefault();
    if (!id) return;
    const body: Record<string, number | string> = { notes: form.notes };
    (["chest", "waist", "hip", "shoulder", "sleeveLength", "inseam", "neck"] as const).forEach(
      (k) => {
        if (form[k] !== "") body[k] = Number(form[k]);
      }
    );
    try {
      await apiJson(`/api/customers/${id}/measurements`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setForm({
        chest: "",
        waist: "",
        hip: "",
        shoulder: "",
        sleeveLength: "",
        inseam: "",
        neck: "",
        notes: ""
      });
      await load();
    } catch (ex) {
      setErr(ex instanceof ApiError ? ex.message : "Failed to save measurement");
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!customer) {
    return <p className="text-sm text-red-600">{err || "Not found"}</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{customer.name}</h1>
          <p className="text-sm text-slate-500">
            {customer.phone}
            {customer.secondaryPhone ? ` · ${customer.secondaryPhone}` : ""}
          </p>
        </div>
        <Link to="/customers" className="text-sm font-semibold text-brand-600 hover:underline">
          ← Customers
        </Link>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Measurement history
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs dark:bg-slate-800">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Chest</th>
                <th className="px-3 py-2">Waist</th>
                <th className="px-3 py-2">Hip</th>
                <th className="px-3 py-2">Shoulder</th>
                <th className="px-3 py-2">Sleeve</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {(customer.measurements || []).map((m: Measurement) => (
                <tr key={m._id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-3 py-2 text-xs">{String(m.recordedAt).slice(0, 10)}</td>
                  <td className="px-3 py-2">{m.chest ?? "—"}</td>
                  <td className="px-3 py-2">{m.waist ?? "—"}</td>
                  <td className="px-3 py-2">{m.hip ?? "—"}</td>
                  <td className="px-3 py-2">{m.shoulder ?? "—"}</td>
                  <td className="px-3 py-2">{m.sleeveLength ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">{m.notes || "—"}</td>
                </tr>
              ))}
              {!(customer.measurements || []).length && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                    No measurements yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form
          onSubmit={onAddMeasurement}
          className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-4 sm:grid-cols-4 dark:border-slate-600"
        >
          {(
            [
              ["chest", "Chest"],
              ["waist", "Waist"],
              ["hip", "Hip"],
              ["shoulder", "Shoulder"],
              ["sleeveLength", "Sleeve"],
              ["inseam", "Inseam"],
              ["neck", "Neck"]
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              type="number"
              step="0.1"
              placeholder={label}
              value={form[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          ))}
          <input
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2 dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white sm:col-span-2"
          >
            Add measurement
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Past orders</h2>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {(customer.orders || []).map((o) => (
            <li key={o._id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <Link
                  to={`/orders/${encodeURIComponent(o.orderId)}`}
                  className="font-mono font-semibold text-brand-600 hover:underline"
                >
                  {o.orderId}
                </Link>
                <p className="text-xs text-slate-500">
                  {String(o.createdAt).slice(0, 10)} · {o.productionStatus}
                </p>
              </div>
              <span className="text-xs text-slate-500">
                Due {String(o.requiredCompletionDate).slice(0, 10)}
              </span>
            </li>
          ))}
          {!(customer.orders || []).length && (
            <li className="px-4 py-6 text-center text-slate-500">No orders yet.</li>
          )}
        </ul>
      </section>
    </div>
  );
}
