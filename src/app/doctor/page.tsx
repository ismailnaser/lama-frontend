"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, logout } from "@/lib/authApi";
import { getAuthToken, setAuthToken, type AuthUser } from "@/lib/auth";
import {
  createPatient,
  exportPatientsExcel,
  listPatients,
  type Patient,
  type Sex,
} from "@/lib/patientsApi";
import { createUser, deleteUser, listUsers, updateUser, type AdminUserRow } from "@/lib/usersApi";
import { isDoctorRole, isSectionAdmin } from "@/lib/roleRouting";
import { Download, LogOut, Moon, Plus, Shield, Sun } from "lucide-react";

type Disposition = "admission" | "discharge" | "observation" | "transfer" | "other";

const DIAGNOSES = [
  { no: 1, name: "Trauma", category: "Surgical" },
  { no: 2, name: "Burn", category: "Surgical" },
  { no: 3, name: "Wound Infection", category: "Surgical" },
  { no: 4, name: "Abscess", category: "Surgical" },
  { no: 5, name: "Post-op Follow-up", category: "Surgical" },
  { no: 6, name: "Fracture", category: "OPD" },
  { no: 7, name: "Soft Tissue Injury", category: "OPD" },
  { no: 8, name: "Other", category: "OPD" },
] as const;

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
  const dxNoPart = parts.find((p) => p.startsWith("dx_no:")) ?? "";
  const dxPart = parts.find((p) => p.startsWith("dx:")) ?? "";
  const dispositionPart = parts.find((p) => p.startsWith("disposition:")) ?? "";
  const customPart = parts.find((p) => p.startsWith("custom:")) ?? "";
  const dxNo = dxNoPart
    ? dxNoPart
        .replace(/^dx_no:/, "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : [];
  const dx = dxPart ? dxPart.replace(/^dx:/, "").split(",").map((s) => s.trim()).filter(Boolean) : [];
  return {
    dxNo,
    dx,
    disposition: dispositionPart.replace(/^disposition:/, "").trim(),
    custom: customPart.replace(/^custom:/, "").trim(),
  };
}

export default function DoctorPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [rows, setRows] = useState<Patient[]>([]);

  const [patientId, setPatientId] = useState("");
  const [sex, setSex] = useState<Sex>("M");
  const [age, setAge] = useState("");
  const [selectedDx, setSelectedDx] = useState<number[]>([]);
  const [ww, setWw] = useState(false);
  const [disposition, setDisposition] = useState<Disposition>("observation");
  const [customNotes, setCustomNotes] = useState("");
  const [adminCreate, setAdminCreate] = useState({
    name: "",
    username: "",
    password: "",
    role: "doctor" as "doctor" | "doctor_admin",
  });
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const canManageDoctorUsers = authUser?.role === "doctor_admin";
  const [userEditing, setUserEditing] = useState<AdminUserRow | null>(null);
  const [userEditForm, setUserEditForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "doctor" as "doctor" | "doctor_admin",
    is_active: true,
  });
  const [userEditSaving, setUserEditSaving] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  function resetForm() {
    setPatientId("");
    setSex("M");
    setAge("");
    setSelectedDx([]);
    setWw(false);
    setDisposition("observation");
    setCustomNotes("");
  }

  function appendPatientId(value: string) {
    setPatientId((prev) => `${prev}${value}`);
  }

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
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    if (!authReady || !authUser || !canManageDoctorUsers) return;
    void reloadAdminUsers();
  }, [authReady, authUser, canManageDoctorUsers]);

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
    const ageBreakdown = [
      { label: "0-4", match: (n: number) => n <= 4 },
      { label: "5-17", match: (n: number) => n >= 5 && n <= 17 },
      { label: "18-49", match: (n: number) => n >= 18 && n <= 49 },
      { label: "50+", match: (n: number) => n >= 50 },
    ].map((g) => ({
      label: g.label,
      male: rows.filter((r) => g.match(r.age) && r.sex === "M").length,
      female: rows.filter((r) => g.match(r.age) && r.sex === "F").length,
    }));
    return { total, male, female, wwCount, nonWw, topDx, ageBreakdown };
  }, [rows]);
  async function reloadAdminUsers() {
    if (!canManageDoctorUsers) return;
    setAdminLoading(true);
    setAdminError(null);
    try {
      const users = await listUsers();
      setAdminUsers(users.filter((u) => u.role === "doctor" || u.role === "doctor_admin"));
    } catch (e) {
      setAdminError(e instanceof Error ? e.message : "Failed to load users.");
    } finally {
      setAdminLoading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const id = patientId.trim();
    const ageNum = Number(age);
    if (!id) return setError("Patient ID is required.");
    if (!Number.isFinite(ageNum) || ageNum < 0) return setError("Age must be a valid number.");
    if (selectedDx.length === 0) return setError("Select at least one diagnosis.");

    const selectedDiagItems = DIAGNOSES.filter((d) => selectedDx.includes(d.no));
    const selectedDxNames = selectedDiagItems.map((d) => d.name);
    const selectedDxNos = selectedDiagItems.map((d) => d.no);
    const hasOpdCategory = selectedDiagItems.some((d) => d.category === "OPD");

    const notesParts = [
      `dx_no:${selectedDxNos.join(",")}`,
      `dx:${selectedDxNames.join(",")}`,
      `disposition:${disposition}`,
      customNotes.trim() ? `custom:${customNotes.trim()}` : "",
    ].filter(Boolean);

    setSaving(true);
    try {
      await createPatient({
        id_no: id,
        sex,
        age: ageNum,
        room: hasOpdCategory ? "room2" : "room1",
        ww,
        notes: notesParts.join(" | "),
      });
      resetForm();
      setToast("Saved successfully.");
      await refreshToday();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function onExport() {
    setExporting(true);
    try {
      const blob = await exportPatientsExcel({ date: todayYmd() });
      downloadBlob(blob, `doctor-opd-${todayYmd()}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
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
            <h1 className="text-xl font-semibold">OPD LoggerX</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="font-semibold">{authUser.username}</span>
              {isSectionAdmin(authUser.role) ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
                  <Shield className="h-3 w-3" /> admin
                </span>
              ) : null}
              {canManageDoctorUsers ? (
                <button
                  type="button"
                  onClick={() => setAdminOpen(true)}
                  disabled={adminLoading}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                  title="Manage users"
                >
                  <span className="inline-flex items-center gap-1">
                    <Plus className="h-3.5 w-3.5" /> Users
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  setAuthUser(null);
                  router.replace("/login");
                }}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                title="Logout"
              >
                <span className="inline-flex items-center gap-1">
                  <LogOut className="h-3.5 w-3.5" /> Logout
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = theme === "dark" ? "light" : "dark";
                  setTheme(next);
                  document.documentElement.classList.toggle("dark", next === "dark");
                  localStorage.setItem("theme", next);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950"
              >
                {theme === "dark" ? (
                  <>
                    <Sun className="h-4 w-4" /> Light
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4" /> Dark
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void onExport()}
                disabled={!authUser || exporting}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-600 px-2 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
              >
                <Download className="h-4 w-4" />
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <form onSubmit={onSubmit} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2">
            <div className="mb-3 text-sm font-semibold">New / Edit Today&apos;s Summary</div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Patient ID</label>
                <input value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "⌫"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (k === "CLR") return setPatientId("");
                        if (k === "⌫") return setPatientId((prev) => prev.slice(0, -1));
                        appendPatientId(k);
                      }}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      {k}
                    </button>
                  ))}
                </div>
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
                  const selected = selectedDx.includes(d.no);
                  return (
                    <button
                      key={d.no}
                      type="button"
                      onClick={() => {
                        setSelectedDx((prev) => {
                          if (prev.includes(d.no)) return prev.filter((x) => x !== d.no);
                          if (prev.length >= 2) return prev;
                          return [...prev, d.no];
                        });
                      }}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selected ? "border-slate-600 bg-slate-600 text-white" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
                    >
                      {d.no}. {d.name}
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
              <button type="button" onClick={resetForm} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                Reset
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
            <div className="mt-4 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Age x Gender</div>
            <div className="mt-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-100 dark:bg-zinc-800/70">
                  <tr>
                    <th className="px-2 py-1 text-left">Age Group</th>
                    <th className="px-2 py-1 text-left">Male</th>
                    <th className="px-2 py-1 text-left">Female</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.ageBreakdown.map((g) => (
                    <tr key={g.label} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-2 py-1">{g.label}</td>
                      <td className="px-2 py-1">{g.male}</td>
                      <td className="px-2 py-1">{g.female}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {canManageDoctorUsers && adminOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Doctor user management">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setAdminOpen(false)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0 sm:max-h-[85vh] sm:overflow-hidden">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Doctor Admin — Manage users</div>
              <button
                type="button"
                onClick={() => setAdminOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
              >
                Close
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <input
                value={adminCreate.name}
                onChange={(e) => setAdminCreate((p) => ({ ...p, name: e.target.value }))}
                placeholder="Name"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
              <input
                value={adminCreate.username}
                onChange={(e) => setAdminCreate((p) => ({ ...p, username: e.target.value }))}
                placeholder="Username"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
              <input
                value={adminCreate.password}
                onChange={(e) => setAdminCreate((p) => ({ ...p, password: e.target.value }))}
                type="password"
                placeholder="Password"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              />
              <select
                value={adminCreate.role}
                onChange={(e) =>
                  setAdminCreate((p) => ({ ...p, role: e.target.value as "doctor" | "doctor_admin" }))
                }
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
              >
                <option value="doctor">doctor</option>
                <option value="doctor_admin">doctor_admin</option>
              </select>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={adminSaving}
                onClick={async () => {
                  setAdminError(null);
                  const name = adminCreate.name.trim();
                  const username = adminCreate.username.trim();
                  const password = adminCreate.password.trim();
                  if (!name || !username || !password) {
                    setAdminError("Name, username and password are required.");
                    return;
                  }
                  setAdminSaving(true);
                  try {
                    await createUser({
                      name,
                      username,
                      password,
                      role: adminCreate.role,
                    });
                    setAdminCreate({ name: "", username: "", password: "", role: "doctor" });
                    await reloadAdminUsers();
                    setToast("Doctor account created.");
                  } catch (e) {
                    setAdminError(e instanceof Error ? e.message : "Failed to create account.");
                  } finally {
                    setAdminSaving(false);
                  }
                }}
                className="rounded-xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
              >
                {adminSaving ? "Creating..." : "Create account"}
              </button>
              {adminError ? (
                <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
                  {adminError}
                </div>
              ) : null}
            </div>

            <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Username</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Name</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Role</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Status</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/70">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {adminUsers.map((u) => (
                    <tr key={u.id} className="border-t border-zinc-200 dark:border-zinc-800">
                      <td className="px-3 py-2 font-semibold">{u.username}</td>
                      <td className="px-3 py-2">{u.name}</td>
                      <td className="px-3 py-2">{u.role}</td>
                      <td className="px-3 py-2">{u.is_active ? "Active" : "Disabled"}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={adminLoading}
                            onClick={() => {
                              setUserEditing(u);
                              setUserEditForm({
                                name: u.name,
                                username: u.username,
                                password: "",
                                role: (u.role === "doctor_admin" ? "doctor_admin" : "doctor") as
                                  | "doctor"
                                  | "doctor_admin",
                                is_active: Boolean(u.is_active),
                              });
                            }}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={adminLoading || u.id === authUser.id}
                            onClick={async () => {
                              setAdminLoading(true);
                              setAdminError(null);
                              try {
                                await updateUser(u.id, { is_active: !u.is_active });
                                await reloadAdminUsers();
                              } catch (e) {
                                setAdminError(e instanceof Error ? e.message : "Failed to update user.");
                              } finally {
                                setAdminLoading(false);
                              }
                            }}
                            className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            {u.is_active ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={adminLoading || u.id === authUser.id}
                            onClick={async () => {
                              setAdminLoading(true);
                              setAdminError(null);
                              try {
                                await deleteUser(u.id);
                                await reloadAdminUsers();
                              } catch (e) {
                                setAdminError(e instanceof Error ? e.message : "Failed to delete user.");
                              } finally {
                                setAdminLoading(false);
                              }
                            }}
                            className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {adminUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">
                        {adminLoading ? "Loading users..." : "No doctor users found."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            </div>
          </div>
        ) : null}

        {userEditing ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setUserEditing(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">Edit doctor user</div>
                <button
                  type="button"
                  onClick={() => setUserEditing(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                <input
                  value={userEditForm.name}
                  onChange={(e) => setUserEditForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Name"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                />
                <input
                  value={userEditForm.username}
                  onChange={(e) => setUserEditForm((p) => ({ ...p, username: e.target.value }))}
                  placeholder="Username"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                />
                <input
                  value={userEditForm.password}
                  onChange={(e) => setUserEditForm((p) => ({ ...p, password: e.target.value }))}
                  type="password"
                  placeholder="New password (optional)"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={userEditForm.role}
                    onChange={(e) =>
                      setUserEditForm((p) => ({
                        ...p,
                        role: e.target.value as "doctor" | "doctor_admin",
                      }))
                    }
                    disabled={userEditing.id === authUser.id}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <option value="doctor">doctor</option>
                    <option value="doctor_admin">doctor_admin</option>
                  </select>
                  <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950">
                    <span>Active</span>
                    <input
                      type="checkbox"
                      checked={userEditForm.is_active}
                      disabled={userEditing.id === authUser.id}
                      onChange={(e) => setUserEditForm((p) => ({ ...p, is_active: e.target.checked }))}
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setUserEditing(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={userEditSaving}
                  onClick={async () => {
                    if (!userEditing) return;
                    if (userEditing.id === authUser.id && userEditForm.role !== "doctor_admin") {
                      setAdminError("You cannot demote your own doctor admin account.");
                      return;
                    }
                    if (userEditing.id === authUser.id && userEditForm.is_active === false) {
                      setAdminError("You cannot disable your own account.");
                      return;
                    }
                    setUserEditSaving(true);
                    setAdminError(null);
                    try {
                      const payload: Parameters<typeof updateUser>[1] = {
                        name: userEditForm.name.trim(),
                        username: userEditForm.username.trim(),
                        role: userEditForm.role,
                        is_active: userEditForm.is_active,
                      };
                      if (userEditForm.password.trim()) payload.password = userEditForm.password.trim();
                      await updateUser(userEditing.id, payload);
                      await reloadAdminUsers();
                      setUserEditing(null);
                      setToast("Doctor user updated.");
                    } catch (e) {
                      setAdminError(e instanceof Error ? e.message : "Failed to update user.");
                    } finally {
                      setUserEditSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                >
                  {userEditSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">All Data / Export</div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    const blob = await exportPatientsExcel({ date: todayYmd() });
                    downloadBlob(blob, `doctor-opd-${todayYmd()}.xlsx`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Export failed.");
                  } finally {
                    setExporting(false);
                  }
                }}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-900"
              >
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
            </div>
          </div>
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
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Dx No(s)</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Dx Name(s)</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Cat</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">WW</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Disposition</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const parsed = parseDoctorNotes(r.notes);
                    const dt = new Date(r.created_at);
                    const time = isNaN(dt.getTime()) ? "-" : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
                    const category = r.room === "room2" ? "OPD" : "Surgical";
                    return (
                      <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="px-3 py-2">{time}</td>
                        <td className="px-3 py-2">{r.id_no}</td>
                        <td className="px-3 py-2">{r.sex === "M" ? "Male" : "Female"}</td>
                        <td className="px-3 py-2">{r.age}</td>
                        <td className="px-3 py-2">{parsed.dxNo.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{parsed.dx.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{category}</td>
                        <td className="px-3 py-2">{r.ww ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{parsed.disposition || "-"}</td>
                        <td className="px-3 py-2 text-zinc-400">—</td>
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
