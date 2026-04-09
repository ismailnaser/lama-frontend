"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  Moon,
  Pencil,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createPatient,
  exportPatientsExcel,
  getPatientsCount,
  listPatients,
  deletePatient,
  updatePatient,
  type Patient,
  type PatientFilters,
  type Sex,
} from "@/lib/patientsApi";
import { useDebounce } from "@/lib/useDebounce";

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

function todayYmd() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysYmd(baseYmd: string, deltaDays: number) {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function formatDdMmYyyy(isoLike: string) {
  const dt = new Date(isoLike);
  if (isNaN(dt.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function WwPill({ value }: { value: string | null }) {
  const v = (value ?? "").trim();
  if (!v) return <span className="text-zinc-400">—</span>;
  const key = v.toLowerCase();
  const isLab = key === "lab";
  const isLap = key === "lap";
  const cls = isLab
    ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200"
    : isLap
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {v}
    </span>
  );
}

const enNumber = new Intl.NumberFormat("en-US");
const enMonth = new Intl.DateTimeFormat("en-US", { month: "long" });

function normalizeYmdRange(range: { from_date: string; to_date: string }) {
  const from = range.from_date?.trim() ?? "";
  const to = range.to_date?.trim() ?? "";
  if (!from || !to) return { from_date: from, to_date: to };
  // YYYY-MM-DD is lexicographically comparable
  if (from <= to) return { from_date: from, to_date: to };
  return { from_date: to, to_date: from };
}

function completeYmdRange(range: { from_date: string; to_date: string }) {
  const from = range.from_date?.trim() ?? "";
  const to = range.to_date?.trim() ?? "";
  if (from && !to) return normalizeYmdRange({ from_date: from, to_date: from });
  if (!from && to) return normalizeYmdRange({ from_date: to, to_date: to });
  return normalizeYmdRange({ from_date: from, to_date: to });
}

type PendingCreate = {
  id: string;
  payload: {
    id_no: string;
    sex: Sex;
    age: number;
    ww?: string;
  };
  created_at: string;
};

const PENDING_KEY = "pendingPatientCreates";

function readPending(): PendingCreate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCreate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePending(items: PendingCreate[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

function formatDayMonthWordYear(isoLike: string) {
  const dt = new Date(isoLike);
  if (isNaN(dt.getTime())) return "";
  const day = String(dt.getDate()); // no leading zero
  const month = enMonth.format(dt).toUpperCase();
  const year = String(dt.getFullYear());
  return `${day}/${month}/${year}`;
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    const stored = localStorage.getItem("theme");
    return stored === "light" || stored === "dark" ? stored : "dark";
  });
  const toastTimerRef = useRef<number | null>(null);
  const filterNoticeTimerRef = useRef<number | null>(null);
  const tableNoticeTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string } | null>(
    null
  );
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<null | {
    id: number;
    id_no: string;
    sex: Sex;
    age: string;
    ww: string;
  }>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | { id: number; idNo: string }>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [tableNotice, setTableNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    id_no: "",
    sex: "M" as Sex,
    age: "",
    ww: "",
  });

  const [idSearch, setIdSearch] = useState("");
  const [dateRange, setDateRange] = useState<{ from_date: string; to_date: string }>({
    from_date: todayYmd(),
    to_date: todayYmd(),
  });
  const fromDateRef = useRef<HTMLInputElement | null>(null);
  const toDateRef = useRef<HTMLInputElement | null>(null);

  const debouncedIdSearch = useDebounce(idSearch, 400);
  const [activeFilter, setActiveFilter] = useState<"id" | "date">("date");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [totalPatients, setTotalPatients] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingCreate[]>([]);
  const [pendingEditing, setPendingEditing] = useState<null | {
    id: string;
    id_no: string;
    sex: Sex;
    age: string;
    ww: string;
  }>(null);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [sort, setSort] = useState<{
    key: "id_no" | "sex" | "age" | "created_at" | "ww";
    dir: "asc" | "desc";
  }>({ key: "created_at", dir: "desc" });

  function showToast(kind: "success" | "error", message: string) {
    setToast({ kind, message });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2200);
  }

  function showFilterNotice(message: string) {
    setFilterNotice(message);
    if (filterNoticeTimerRef.current) window.clearTimeout(filterNoticeTimerRef.current);
    filterNoticeTimerRef.current = window.setTimeout(() => setFilterNotice(null), 2200);
  }

  function showTableNotice(message: string) {
    setTableNotice(message);
    if (tableNoticeTimerRef.current) window.clearTimeout(tableNoticeTimerRef.current);
    tableNoticeTimerRef.current = window.setTimeout(() => setTableNotice(null), 2200);
  }

  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setEditing(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing]);

  useEffect(() => {
    if (!deleteConfirm) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDeleteConfirm(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirm]);

  useLayoutEffect(() => {
    // Apply theme before paint to avoid flash.
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

  const effectiveFilters = useMemo((): PatientFilters => {
    const completed = completeYmdRange(dateRange);
    if (activeFilter === "id") {
      const id = debouncedIdSearch.trim();
      return id ? { id_no: id } : completed.from_date && completed.to_date ? completed : {};
    }
    return completed.from_date && completed.to_date ? completed : {};
  }, [activeFilter, debouncedIdSearch, dateRange]);

  async function refresh(override?: PatientFilters) {
    setError(null);
    setLoading(true);
    try {
      const activeFilters = override ?? effectiveFilters;
      const [data, count] = await Promise.all([
        listPatients(activeFilters),
        getPatientsCount().catch(() => null),
      ]);
      setPatients(data);
      setTotalPatients(count);
      setPage(1);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load data";
      setError(msg);
      showToast("error", msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFilters.id_no, effectiveFilters.from_date, effectiveFilters.to_date, effectiveFilters.date]);

  useEffect(() => {
    // When exiting filters UI, clear filters from the table view.
    if (filtersOpen) return;
    setIdSearch("");
    setDateRange({ from_date: "", to_date: "" });
    setFiltersApplied(false);
    void refresh({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersOpen]);

  async function flushPendingCreates() {
    if (typeof window === "undefined") return;
    if (!navigator.onLine) return;
    const items = readPending();
    if (items.length === 0) return;

    const remaining: PendingCreate[] = [];
    for (const item of items) {
      try {
        await createPatient(item.payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        // If patient already exists on server, drop it from queue.
        if (msg.includes("Patient already exists") || msg.includes("409")) {
          continue;
        }
        remaining.push(item);
      }
    }
    writePending(remaining);
    setPendingCount(remaining.length);
    await refresh();
    if (items.length !== remaining.length) {
      showToast("success", "Pending patients synced successfully.");
    }
  }

  function openPending() {
    const items = readPending();
    setPendingItems(items);
    setPendingOpen(true);
  }

  function closePending() {
    setPendingOpen(false);
  }

  function removePendingItem(id: string) {
    const next = readPending().filter((x) => x.id !== id);
    writePending(next);
    setPendingItems(next);
    setPendingCount(next.length);
    showToast("success", "Pending item deleted.");
  }

  function clearAllPending() {
    writePending([]);
    setPendingItems([]);
    setPendingCount(0);
    showToast("success", "All pending items cleared.");
  }

  useEffect(() => {
    setPendingCount(readPending().length);
    void flushPendingCreates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onOnline() {
      void flushPendingCreates();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const idNo = form.id_no.trim();
      if (!/^\d+$/.test(idNo)) {
        showToast("error", "ID No must contain digits only.");
        return;
      }

      const existing = await listPatients({ id_no: idNo });
      if (existing.length > 0) {
        setIdSearch(idNo);
        setFiltersApplied(true);
        await refresh();
        showToast("error", "Patient already exists.");
        return;
      }

      const ageRaw = form.age.trim();
      if (!/^\d+$/.test(ageRaw)) {
        showToast("error", "Age must be a valid number.");
        return;
      }
      const ageNum = Number(ageRaw);
      if (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 150) {
        showToast("error", "Age must be between 0 and 150.");
        return;
      }
      const payload = {
        id_no: idNo,
        sex: form.sex,
        age: ageNum,
        ww: form.ww,
      };

      if (typeof window !== "undefined" && !navigator.onLine) {
        const next: PendingCreate[] = [
          ...readPending(),
          { id: crypto.randomUUID(), payload, created_at: new Date().toISOString() },
        ];
        writePending(next);
        setPendingCount(next.length);
        setForm((p) => ({ ...p, id_no: "", age: "", ww: "" }));
        showToast("success", "Saved offline. Will sync when online.");
        return;
      }

      try {
        await createPatient(payload);
      } catch (e) {
        // Network failure → queue for later
        if (e instanceof TypeError || !navigator.onLine) {
          const next: PendingCreate[] = [
            ...readPending(),
            { id: crypto.randomUUID(), payload, created_at: new Date().toISOString() },
          ];
          writePending(next);
          setPendingCount(next.length);
          setForm((p) => ({ ...p, id_no: "", age: "", ww: "" }));
          showToast("success", "Saved offline. Will sync when online.");
          return;
        }
        throw e;
      }
      setForm((p) => ({ ...p, id_no: "", age: "", ww: "" }));
      await refresh();
      showToast("success", "Patient saved successfully.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
      showToast("error", msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function onExport() {
    setError(null);
    try {
      const blob = await exportPatientsExcel(effectiveFilters);
      const label =
        effectiveFilters.date ??
        (effectiveFilters.from_date && effectiveFilters.to_date
          ? `${effectiveFilters.from_date}_to_${effectiveFilters.to_date}`
          : todayYmd());
      downloadBlob(blob, `surgical-dressing-log-${label}.csv`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Export failed";
      setError(msg);
      showToast("error", msg);
    }
  }

  const sortedPatients = useMemo(() => {
    const dirMul = sort.dir === "asc" ? 1 : -1;
    const arr = [...patients];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (sort.key === "age") return (Number(av) - Number(bv)) * dirMul;
      if (sort.key === "created_at") {
        return (new Date(String(av)).getTime() - new Date(String(bv)).getTime()) * dirMul;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dirMul;
    });
    return arr;
  }, [patients, sort]);

  const tableTitle = useMemo(() => {
    if (!filtersApplied) return "Patient Records Table";

    if (activeFilter === "id") {
      const id = idSearch.trim();
      return id ? `Patient Records — ID: ${id}` : "Patient Records (Filtered)";
    }

    const from = dateRange.from_date?.trim();
    const to = dateRange.to_date?.trim();
    if (from && to) {
      return `Patient Records — ${formatDayMonthWordYear(from)} to ${formatDayMonthWordYear(to)}`;
    }
    return "Patient Records (Filtered)";
  }, [filtersApplied, activeFilter, idSearch, dateRange]);

  const totalPages = Math.max(1, Math.ceil(sortedPatients.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const pagedPatients = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedPatients.slice(start, start + pageSize);
  }, [sortedPatients, safePage]);

  function toggleSort(key: typeof sort.key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  function setQuickRange(kind: "today" | "week" | "month") {
    const t = todayYmd();
    const from = (() => {
      if (kind === "today") return t;

      // Week starts on Saturday (as requested)
      if (kind === "week") {
        const [y, m, d] = t.split("-").map(Number);
        const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
        const dow = dt.getDay(); // 0=Sun ... 6=Sat
        const daysSinceSaturday = (dow - 6 + 7) % 7;
        return addDaysYmd(t, -daysSinceSaturday);
      }

      // Month = from day 1 of current month
      const [y, m] = t.split("-").map(Number);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${y}-${pad(m ?? 1)}-01`;
    })();
    setActiveFilter("date");
    const nextFilters: PatientFilters = { from_date: from, to_date: t };
    setDateRange(completeYmdRange({ from_date: from, to_date: t }));
    setFiltersApplied(true);
    void refresh(nextFilters);
    showFilterNotice("Filter applied successfully.");
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {pendingEditing ? (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Edit pending offline patient"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setPendingEditing(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Edit Pending Patient
                </div>
                <button
                  type="button"
                  onClick={() => setPendingEditing(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    ID NO
                  </label>
                  <input
                    value={pendingEditing.id_no}
                    onChange={(e) =>
                      setPendingEditing((p) => (p ? { ...p, id_no: e.target.value } : p))
                    }
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Numbers only"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Age</label>
                  <input
                    value={pendingEditing.age}
                    onChange={(e) =>
                      setPendingEditing((p) => (p ? { ...p, age: e.target.value } : p))
                    }
                    inputMode="numeric"
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="0 - 150"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sex</label>
                  <select
                    value={pendingEditing.sex}
                    onChange={(e) =>
                      setPendingEditing((p) =>
                        p ? { ...p, sex: e.target.value as Sex } : p
                      )
                    }
                    aria-label="Sex"
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  >
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Notes/WW
                </label>
                <textarea
                  value={pendingEditing.ww}
                  onChange={(e) =>
                    setPendingEditing((p) => (p ? { ...p, ww: e.target.value } : p))
                  }
                  className="mt-1 min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  placeholder="Type / notes"
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPendingEditing(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pendingSaving}
                  onClick={async () => {
                    if (!pendingEditing) return;
                    setPendingSaving(true);
                    try {
                      const idNo = pendingEditing.id_no.trim();
                      if (!/^\d+$/.test(idNo)) {
                        showToast("error", "ID No must contain digits only.");
                        return;
                      }
                      const ageRaw = pendingEditing.age.trim();
                      if (!/^\d+$/.test(ageRaw)) {
                        showToast("error", "Age must be a valid number.");
                        return;
                      }
                      const ageNum = Number(ageRaw);
                      if (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 150) {
                        showToast("error", "Age must be between 0 and 150.");
                        return;
                      }

                      const items = readPending();
                      const idx = items.findIndex((x) => x.id === pendingEditing.id);
                      if (idx === -1) {
                        showToast("error", "Pending item not found.");
                        setPendingEditing(null);
                        return;
                      }
                      const next: PendingCreate[] = items.map((x) =>
                        x.id === pendingEditing.id
                          ? {
                              ...x,
                              payload: {
                                id_no: idNo,
                                sex: pendingEditing.sex,
                                age: ageNum,
                                ww: pendingEditing.ww.trim(),
                              },
                            }
                          : x
                      );
                      writePending(next);
                      setPendingItems(next);
                      setPendingCount(next.length);
                      setPendingEditing(null);
                      showToast("success", "Pending item updated.");
                    } finally {
                      setPendingSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700"
                >
                  {pendingSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {pendingOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Pending offline patients"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={closePending}
              aria-label="Close"
            />
            <div className="relative w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Pending offline patients ({pendingItems.length})
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={pendingItems.length === 0}
                    onClick={clearAllPending}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-900 shadow-sm transition-colors hover:bg-rose-100 active:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-100 dark:hover:bg-rose-900/30 dark:active:bg-rose-900/40"
                  >
                    Clear all
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await flushPendingCreates();
                      setPendingItems(readPending());
                    }}
                    className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700"
                  >
                    Sync now
                  </button>
                  <button
                    type="button"
                    onClick={closePending}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                  >
                    Close
                  </button>
                </div>
              </div>

              {pendingItems.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-300">
                  No pending patients.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="text-left font-semibold text-zinc-700 dark:text-zinc-200">
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">ID No</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Sex</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Age</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Notes</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Saved at</th>
                        <th className="bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/60">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((it) => (
                        <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="px-3 py-2 font-medium">{it.payload.id_no}</td>
                          <td className="px-3 py-2">{it.payload.sex}</td>
                          <td className="px-3 py-2">{it.payload.age}</td>
                          <td className="px-3 py-2">{it.payload.ww ?? ""}</td>
                          <td className="px-3 py-2">{it.created_at}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setPendingEditing({
                                    id: it.id,
                                    id_no: it.payload.id_no,
                                    sex: it.payload.sex,
                                    age: String(it.payload.age),
                                    ww: it.payload.ww ?? "",
                                  })
                                }
                                className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                title="Edit"
                                aria-label="Edit"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removePendingItem(it.id)}
                                className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                title="Delete"
                                aria-label="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {editing ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Edit patient"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setEditing(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Edit Patient
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    ID NO
                  </label>
                  <input
                    value={editing.id_no}
                    onChange={(e) => setEditing((p) => (p ? { ...p, id_no: e.target.value } : p))}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="ID NO"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Age
                  </label>
                  <input
                    value={editing.age}
                    onChange={(e) => setEditing((p) => (p ? { ...p, age: e.target.value } : p))}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Age"
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Sex
                  </label>
                  <select
                    value={editing.sex}
                    onChange={(e) =>
                      setEditing((p) => (p ? { ...p, sex: e.target.value as Sex } : p))
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    title="Sex"
                  >
                    <option value="M">M</option>
                    <option value="F">F</option>
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Notes/WW
                </label>
                <textarea
                  value={editing.ww}
                  onChange={(e) => setEditing((p) => (p ? { ...p, ww: e.target.value } : p))}
                  className="mt-1 min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  placeholder="Type / notes"
                />
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={editSaving}
                  onClick={async () => {
                    if (!editing) return;
                    setEditSaving(true);
                    try {
                      const idNo = editing.id_no.trim();
                      if (!/^\d+$/.test(idNo)) {
                        showToast("error", "ID No must contain digits only.");
                        return;
                      }
                      const ageRaw = editing.age.trim();
                      if (!/^\d+$/.test(ageRaw)) {
                        showToast("error", "Age must be a valid number.");
                        return;
                      }
                      const ageNum = Number(ageRaw);
                      if (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 150) {
                        showToast("error", "Age must be between 0 and 150.");
                        return;
                      }
                      await updatePatient(editing.id, {
                        id_no: idNo,
                        sex: editing.sex,
                        age: ageNum,
                        ww: editing.ww.trim() ? editing.ww.trim() : null,
                      });
                      setEditing(null);
                      await refresh();
                      showTableNotice("Edited successfully.");
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Save failed";
                      showToast("error", msg);
                    } finally {
                      setEditSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700"
                >
                  {editSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {deleteConfirm ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setDeleteConfirm(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Confirm delete
              </div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Do you want to delete this patient{deleteConfirm.idNo ? ` (${deleteConfirm.idNo})` : ""}?
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteSaving}
                  onClick={async () => {
                    if (!deleteConfirm) return;
                    setDeleteSaving(true);
                    try {
                      await deletePatient(deleteConfirm.id);
                      setDeleteConfirm(null);
                      await refresh();
                      showTableNotice("Deleted successfully.");
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Delete failed";
                      showToast("error", msg);
                    } finally {
                      setDeleteSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500 dark:active:bg-red-700"
                >
                  {deleteSaving ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {toast ? (
          <div className="mb-4">
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-medium shadow-sm ${
                toast.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100"
                  : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100"
              }`}
              role="status"
              aria-live="polite"
            >
              {toast.message}
            </div>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Surgical Dressing Log
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark";
                setTheme(next);
                // Apply immediately for responsive UX.
                document.documentElement.classList.toggle("dark", next === "dark");
                localStorage.setItem("theme", next);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800 dark:active:bg-zinc-800/80 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950"
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
              className="inline-flex items-center gap-2 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                Add Patient
              </div>
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      ID NO
                    </label>
                    <input
                      value={form.id_no}
                      onChange={(e) => setForm((p) => ({ ...p, id_no: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                      placeholder="ID NO"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Age
                    </label>
                    <input
                      value={form.age}
                      onChange={(e) => setForm((p) => ({ ...p, age: e.target.value }))}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                      placeholder="Age"
                      inputMode="numeric"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Sex
                    </label>
                    <select
                      value={form.sex}
                      onChange={(e) => setForm((p) => ({ ...p, sex: e.target.value as Sex }))}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                      title="Sex"
                    >
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    WW (optional)
                  </label>
                  <textarea
                    value={form.ww}
                    onChange={(e) => setForm((p) => ({ ...p, ww: e.target.value }))}
                    className="mt-1 min-h-[84px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Type / notes"
                  />
                </div>

                <button
                  disabled={submitting}
                  className="w-full rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
                >
                  {submitting ? "Saving..." : "Save"}
                </button>
              </form>

            </div>

            <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (filtersOpen && activeFilter === "id") setFiltersOpen(false);
                    else {
                      if (activeFilter === "date") {
                        setDateRange({ from_date: "", to_date: "" });
                        setFiltersApplied(false);
                        void refresh({});
                      }
                      setActiveFilter("id");
                      setFiltersOpen(true);
                    }
                  }}
                  className={`rounded-xl border px-2 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
                    filtersOpen && activeFilter === "id"
                      ? "border-slate-300 bg-slate-600 text-white dark:border-slate-700 dark:bg-slate-600"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                  }`}
                >
                  ID Filter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (filtersOpen && activeFilter === "date") setFiltersOpen(false);
                    else {
                      if (activeFilter === "id") setIdSearch("");
                      setActiveFilter("date");
                      setFiltersOpen(true);
                    }
                  }}
                  className={`rounded-xl border px-2 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
                    filtersOpen && activeFilter === "date"
                      ? "border-slate-300 bg-slate-600 text-white dark:border-slate-700 dark:bg-slate-600"
                      : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                  }`}
                >
                  DATE Filter
                </button>
              </div>

              {filtersOpen ? (
                <div className="mt-2 space-y-2">
                  {activeFilter === "id" ? (
                    <>
                      <div>
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                          Search by ID NO
                        </label>
                        <input
                          value={idSearch}
                          onChange={(e) => setIdSearch(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                          placeholder="Search by ID NO"
                        />
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await refresh({ id_no: idSearch.trim() });
                            setFiltersApplied(true);
                            showFilterNotice("ID filter applied successfully.");
                          }}
                          className="flex-1 rounded-xl bg-slate-600 px-2 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setIdSearch("");
                            const normalized = completeYmdRange(dateRange);
                            const nextFilters =
                              normalized.from_date && normalized.to_date ? normalized : ({} as PatientFilters);
                            await refresh(nextFilters);
                            setFiltersApplied(false);
                            showFilterNotice("ID filter cleared successfully.");
                          }}
                          className="flex-1 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-900/80 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950"
                        >
                          Clear
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        Date Range
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            From
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const el = fromDateRef.current;
                              if (!el) return;
                              // Chromium browsers
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              (el as any).showPicker?.();
                              el.focus();
                              el.click();
                            }}
                            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-left text-xs font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                            title="From date"
                          >
                            <span className={dateRange.from_date ? "" : "text-zinc-400 dark:text-zinc-400"}>
                              {dateRange.from_date
                                ? formatDayMonthWordYear(dateRange.from_date)
                                : "Select date"}
                            </span>
                            <span className="text-zinc-400" aria-hidden="true">
                              📅
                            </span>
                          </button>
                          <input
                            ref={fromDateRef}
                            type="date"
                            value={dateRange.from_date ?? ""}
                            onChange={(e) =>
                              setDateRange((p) => completeYmdRange({ ...p, from_date: e.target.value }))
                            }
                            className="sr-only"
                            aria-label="From date"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            To
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              const el = toDateRef.current;
                              if (!el) return;
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              (el as any).showPicker?.();
                              el.focus();
                              el.click();
                            }}
                            className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-left text-xs font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                            title="To date"
                          >
                            <span className={dateRange.to_date ? "" : "text-zinc-400 dark:text-zinc-400"}>
                              {dateRange.to_date ? formatDayMonthWordYear(dateRange.to_date) : "Select date"}
                            </span>
                            <span className="text-zinc-400" aria-hidden="true">
                              📅
                            </span>
                          </button>
                          <input
                            ref={toDateRef}
                            type="date"
                            value={dateRange.to_date ?? ""}
                            onChange={(e) =>
                              setDateRange((p) => completeYmdRange({ ...p, to_date: e.target.value }))
                            }
                            className="sr-only"
                            aria-label="To date"
                          />
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1 pt-1">
                        {(
                          [
                            { label: "Daily", kind: "today" as const },
                            { label: "Weekly", kind: "week" as const },
                            { label: "Monthly", kind: "month" as const },
                          ] as const
                        ).map(({ label, kind }) => {
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => setQuickRange(kind)}
                              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-100 active:bg-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950"
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const today = todayYmd();
                            const normalized = completeYmdRange(dateRange);
                            const from = normalized.from_date;
                            const to = normalized.to_date;
                            setDateRange(normalized);

                            if ((from && from > today) || (to && to > today)) {
                              showFilterNotice("No records for future dates.");
                              return;
                            }

                            const data = await refresh({ from_date: from, to_date: to });
                            setFiltersApplied(true);
                            showFilterNotice(
                              data && data.length === 0
                                ? "No records for selected date."
                                : "Filter applied successfully."
                            );
                          }}
                          className="flex-1 rounded-xl bg-slate-600 px-2 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setDateRange({ from_date: todayYmd(), to_date: todayYmd() });
                            await refresh({ from_date: todayYmd(), to_date: todayYmd() });
                            setFiltersApplied(false);
                            showFilterNotice("Date filter cleared successfully.");
                          }}
                          className="flex-1 rounded-xl border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-900/80 dark:focus-visible:ring-zinc-600 dark:focus-visible:ring-offset-zinc-950"
                        >
                          Clear
                        </button>
                      </div>
                    </>
                  )}

                  {filterNotice ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100">
                      {filterNotice}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  {tableTitle}
                </div>
                {pendingCount > 0 ? (
                  <button
                    type="button"
                    onClick={openPending}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 active:bg-amber-200 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/30"
                    title="Sync pending offline saves"
                  >
                    {pendingCount} pending
                  </button>
                ) : null}
              </div>

              {tableNotice ? (
                <div className="px-4 pt-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100">
                    {tableNotice}
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="px-4 py-3 text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                      <th className="sticky top-0 bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("id_no")}
                          className="inline-flex items-center gap-1"
                        >
                          ID No <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("sex")}
                          className="inline-flex items-center gap-1"
                        >
                          Sex <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("age")}
                          className="inline-flex items-center gap-1"
                        >
                          Age <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 w-[84px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:w-[96px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("ww")}
                          className="inline-flex items-center gap-1"
                        >
                          Notes <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 w-[84px] bg-zinc-100 px-2 py-2 text-right dark:bg-zinc-800/60 sm:w-[104px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        Actions
                      </th>
                      <th className="sticky top-0 bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3">
                        <button
                          type="button"
                          onClick={() => toggleSort("created_at")}
                          className="inline-flex items-center gap-1"
                        >
                          Date <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="text-xs sm:text-sm">
                    {pagedPatients.map((p) => {
                      return (
                        <tr
                          key={p.id}
                          className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                        >
                          <td className="px-2 py-2 align-top font-medium sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            {p.id_no}
                          </td>
                          <td className="px-2 py-2 align-top sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <span className="inline-flex min-w-[24px] justify-center rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                              {p.sex}
                            </span>
                          </td>
                          <td className="px-2 py-2 align-top sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            {p.age}
                          </td>
                          <td className="w-[84px] px-2 py-2 align-top sm:w-[96px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <WwPill value={p.ww} />
                          </td>
                          <td className="w-[84px] px-2 py-2 align-top sm:w-[104px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <div className="flex justify-end gap-2 whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                              <button
                                type="button"
                                onClick={async () => {
                                  setEditing({
                                    id: p.id,
                                    id_no: p.id_no ?? "",
                                    sex: p.sex,
                                    age: String(p.age ?? ""),
                                    ww: p.ww ?? "",
                                  });
                                }}
                                title="Edit"
                                className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  setDeleteConfirm({ id: p.id, idNo: p.id_no ?? "" });
                                }}
                                title="Delete"
                                className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 align-top sm:px-4 sm:py-3">
                            {formatDayMonthWordYear(p.created_at)}
                          </td>
                        </tr>
                      );
                    })}

                    {!loading && pagedPatients.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400"
                        >
                          No rows found for the current filters.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {loading
                      ? "Loading…"
                      : `${enNumber.format(
                          filtersApplied ? patients.length : totalPatients ?? patients.length
                        )} Patients`}
                  </div>

                  <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:w-auto sm:justify-end">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-1.5 sm:text-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </button>

                    <div className="-mx-1 inline-flex max-w-full items-center gap-2 overflow-x-auto px-1">
                      {Array.from({ length: Math.min(3, totalPages) }).map((_, i) => {
                        const n = i + 1;
                        return (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPage(n)}
                            className={`h-8 w-8 shrink-0 rounded-lg border text-sm font-medium shadow-sm transition-colors ${
                              safePage === n
                                ? "border-zinc-300 bg-zinc-200 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                                : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                            }`}
                          >
                            {n}
                          </button>
                        );
                      })}
                      {totalPages > 3 ? <span className="px-1 text-zinc-500">…</span> : null}
                      {totalPages > 1 ? (
                        <button
                          type="button"
                          onClick={() => setPage(totalPages)}
                          className={`h-8 w-8 shrink-0 rounded-lg border text-sm font-medium shadow-sm transition-colors ${
                            safePage === totalPages
                              ? "border-zinc-300 bg-zinc-200 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50"
                              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                          }`}
                        >
                          {totalPages}
                        </button>
                      ) : null}
                    </div>

                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 sm:px-3 sm:py-1.5 sm:text-sm dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
