import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiJson, ApiError } from "@/lib/api";
import type { ProductionStage, Staff, StaffStatus } from "@/lib/types";
import { PRODUCTION_STAGES } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export function StaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [staff, setStaff] = useState<Staff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [skills, setSkills] = useState<ProductionStage[]>([]);

  async function load() {
    if (!id) return;
    try {
      const data = await apiJson<Staff>(`/api/staff/${id}`);
      setStaff(data);
      setSkills(data.skills || []);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function setStatus(status: StaffStatus) {
    if (!id) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setStaff(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Update failed");
    }
  }

  async function saveSkills() {
    if (!id) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ skills })
      });
      setStaff(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Skills update failed");
    }
  }

  async function deactivate() {
    if (!id || !confirm("Deactivate this staff member?")) return;
    try {
      const updated = await apiJson<Staff>(`/api/staff/${id}/deactivate`, { method: "POST" });
      setStaff(updated);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Deactivate failed");
    }
  }

  if (!staff && !err) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!staff) return <p className="text-sm text-red-600">{err}</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{staff.name}</h1>
          <p className="text-sm text-slate-500">
            {staff.role} · {staff.phone} · skill {staff.skillLevel}/5
          </p>
        </div>
        <Link to="/staff" className="text-sm font-semibold text-brand-600 hover:underline">
          ← Staff
        </Link>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <section className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Status:</span>
          <StatusBadge status={staff.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {(["AVAILABLE", "BUSY", "OFF_DUTY"] as StaffStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
            >
              Set {s.replace("_", " ")}
            </button>
          ))}
          {staff.active && (
            <button
              type="button"
              onClick={deactivate}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              Deactivate
            </button>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Stage skills
        </h2>
        <div className="flex flex-wrap gap-2">
          {PRODUCTION_STAGES.map((stage) => {
            const on = skills.includes(stage);
            return (
              <button
                key={stage}
                type="button"
                onClick={() =>
                  setSkills((prev) =>
                    on ? prev.filter((s) => s !== stage) : [...prev, stage]
                  )
                }
                className={
                  on
                    ? "rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
                    : "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold dark:border-slate-600"
                }
              >
                {stage}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={saveSkills}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-brand-600"
        >
          Save skills
        </button>
      </section>
    </div>
  );
}
