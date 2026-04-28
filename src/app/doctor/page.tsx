"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, logout } from "@/lib/authApi";
import { getAuthToken, setAuthToken, type AuthUser } from "@/lib/auth";
import { createPatient, listPatients, type Patient, type Sex } from "@/lib/patientsApi";
import { isDoctorRole, isSectionAdmin } from "@/lib/roleRouting";

type Disposition = "admission" | "discharge" | "observation" | "transfer" | "other";

const DIAGNOSES = [
  "Trauma",
  "Burn",
  "Wound Infection",
  "Abscess",
  "Post-op Follow-up",
  "Fracture",
  "Soft Tissue Injury",
  "Other",
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseDoctorNotes(notes: string | null) {
  const raw = notes ?? "";
  const parts = raw.split("|").map((x) => x.trim());
  const dxPart = parts.find((p) => p.startsWith("dx:")) ?? "";
  const dispositionPart = parts.find((p) => p.startsWith("disposition:")) ?? "";
  const customPart = parts.find((p) => p.startsWith("custom:")) ?? "";
  const dx = dxPart ? dxPart.replace(/^dx:/, "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    dx,
    disposition: dispositionPart.replace(/^disposition:/, "").trim(),
    custom: customPart.replace(/^custom:/, "").trim(),
  };
}

export default function DoctorPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rows, setRows] = useState<Patient[]>([]);

  const [patientId, setPatientId] = useState("");
  const [sex, setSex] = useState<Sex>("M");
  const [age, setAge] = useState("");
  const [selectedDx, setSelectedDx] = useState<string[]>([]);
  const [ww, setWw] = useState(false);
  const [disposition, setDisposition] = useState<Disposition>("observation");
  const [customNotes, setCustomNotes] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getAuthToken();
      if (!token) {
        router.replace("/login");
        return;
      }
      try {
        const u = await fetchCurrentUser();
        if (cancelled) return;
        if (!isDoctorRole(u.role)) {
          router.replace("/");
          return;
        }
        setAuthUser(u);
      } catch {
        setAuthToken(null);
        if (!cancelled) router.replace("/login");
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function refreshToday() {
    setLoading(true);
    setError(null);
    try {
      const data = await listPatients({ date: todayYmd() });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !authUser) return;
    void refreshToday();
  }, [authReady, authUser]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const stats = useMemo(() => {
    const total = rows.length;
    const male = rows.filter((r) => r.sex === "M").length;
    const female = rows.filter((r) => r.sex === "F").length;
    const wwCount = rows.filter((r) => r.ww).length;
    const nonWw = total - wwCount;
    const dxCounts = new Map<string, number>();
    for (const r of rows) {
      const parsed = parseDoctorNotes(r.notes);
      for (const d of parsed.dx) {
        dxCounts.set(d, (dxCounts.get(d) ?? 0) + 1);
      }
    }
    const topDx = [...dxCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { total, male, female, wwCount, nonWw, topDx };
  }, [rows]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const id = patientId.trim();
    const ageNum = Number(age);
    if (!id) return setError("Patient ID is required.");
    if (!Number.isFinite(ageNum) || ageNum < 0) return setError("Age must be a valid number.");
    if (selectedDx.length === 0) return setError("Select at least one diagnosis.");

    const notesParts = [
      `dx:${selectedDx.join(",")}`,
      `disposition:${disposition}`,
      customNotes.trim() ? `custom:${customNotes.trim()}` : "",
    ].filter(Boolean);

    setSaving(true);
    try {
      await createPatient({
        id_no: id,
        sex,
        age: ageNum,
        room: "room1",
        ww,
        notes: notesParts.join(" | "),
      });
      setPatientId("");
      setAge("");
      setSelectedDx([]);
      setWw(false);
      setDisposition("observation");
      setCustomNotes("");
      setToast("Saved successfully.");
      await refreshToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!authReady || !authUser) {
    return (
      <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center px-4">
          <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Doctor Section</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">OPD LoggerX style interface</p>
          </div>
          <div className="flex items-center gap-2">
            {isSectionAdmin(authUser.role) ? (
              <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                doctor admin
              </span>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                await logout();
                router.replace("/login");
              }}
              className="rounded-xl bg-slate-600 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Logout
            </button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <form onSubmit={onSubmit} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2">
            <div className="mb-3 text-sm font-semibold">New / Edit Today&apos;s Summary</div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Patient ID</label>
                <input value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Age</label>
                <input value={age} onChange={(e) => setAge(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Gender</label>
                <select value={sex} onChange={(e) => setSex(e.target.value as Sex)} className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Disposition</label>
                <select value={disposition} onChange={(e) => setDisposition(e.target.value as Disposition)} className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <option value="admission">Admission</option>
                  <option value="discharge">Discharge</option>
                  <option value="observation">Observation</option>
                  <option value="transfer">Transfer</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Diagnosis (up to 2)</div>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {DIAGNOSES.map((d) => {
                  const selected = selectedDx.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setSelectedDx((prev) => {
                          if (prev.includes(d)) return prev.filter((x) => x !== d);
                          if (prev.length >= 2) return prev;
                          return [...prev, d];
                        });
                      }}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selected ? "border-slate-600 bg-slate-600 text-white" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                <span>War Wounded?</span>
                <input type="checkbox" checked={ww} onChange={(e) => setWw(e.target.checked)} />
              </label>
              <input value={customNotes} onChange={(e) => setCustomNotes(e.target.value)} placeholder="Optional notes" className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
            </div>

            {error ? <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">{error}</div> : null}
            {toast ? <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100">{toast}</div> : null}

            <div className="mt-3 flex gap-2">
              <button disabled={saving} type="submit" className="rounded-xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                {saving ? "Saving..." : "Save & New"}
              </button>
              <button type="button" onClick={() => void refreshToday()} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                Refresh
              </button>
            </div>
          </form>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-semibold">Today stats</div>
            <div className="mt-2 space-y-1 text-sm">
              <div>Total: {stats.total}</div>
              <div>Male: {stats.male}</div>
              <div>Female: {stats.female}</div>
              <div>Surgical WW/Non: {stats.wwCount}/{stats.nonWw}</div>
            </div>
            <div className="mt-4 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Top Diagnoses</div>
            <div className="mt-1 space-y-1 text-sm">
              {stats.topDx.length === 0 ? <div className="text-zinc-500">No data yet</div> : stats.topDx.map(([dx, c]) => <div key={dx}>{dx}: {c}</div>)}
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 text-sm font-semibold">All Data / Today</div>
          {loading ? (
            <div className="text-sm text-zinc-500">Loading...</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Time</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Patient ID</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Gender</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Age</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Dx</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">WW</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const parsed = parseDoctorNotes(r.notes);
                    const dt = new Date(r.created_at);
                    const time = isNaN(dt.getTime()) ? "-" : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
                    return (
                      <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="px-3 py-2">{time}</td>
                        <td className="px-3 py-2">{r.id_no}</td>
                        <td className="px-3 py-2">{r.sex === "M" ? "Male" : "Female"}</td>
                        <td className="px-3 py-2">{r.age}</td>
                        <td className="px-3 py-2">{parsed.dx.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{r.ww ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{parsed.disposition || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
