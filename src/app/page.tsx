"use client";

import { PwaClient } from "@/components/PwaClient";
import {
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  LogOut,
  Moon,
  Plus,
  Pencil,
  Shield,
  Sun,
  Trash2,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  createPatient,
  exportPatientsExcel,
  getPatientsCount,
  getPatientAudits,
  listPatients,
  deletePatient,
  updatePatient,
  type Patient,
  type PatientFilters,
  type PatientAuditLog,
  type Sex,
} from "@/lib/patientsApi";
import { useDebounce } from "@/lib/useDebounce";
import { fetchCurrentUser, logout } from "@/lib/authApi";
import { getAuthToken, setAuthToken, type AuthUser } from "@/lib/auth";
import { createUser, deleteUser, listUsers, updateUser, type AdminUserRow } from "@/lib/usersApi";
import { PatientAuditDetails } from "@/lib/patientAuditDetails";
import { isDoctorRole, isSectionAdmin } from "@/lib/roleRouting";

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

function WarBoolCell({ value }: { value: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
        value
          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
      }`}
    >
      {value ? "Yes" : "No"}
    </span>
  );
}

function NotesPreview({ value }: { value: string | null }) {
  const t = (value ?? "").trim();
  if (!t) return <span className="text-zinc-400">—</span>;
  const short = t.length > 56 ? `${t.slice(0, 56)}…` : t;
  return (
    <span title={t} className="block max-w-[220px] truncate text-left sm:max-w-[min(360px,40vw)]">
      {short}
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
    room: "room1" | "room2";
    ww: boolean;
    lab: boolean;
    burn: boolean;
    notes: string;
  };
  created_at: string;
};

const PENDING_KEY = "pendingPatientCreates";

function normalizePendingPayload(
  p: PendingCreate["payload"] | Record<string, unknown>
): PendingCreate["payload"] {
  const o = p as Record<string, unknown>;
  const id_no = String(o.id_no ?? "");
  const sex = (o.sex === "F" ? "F" : "M") as Sex;
  const age = typeof o.age === "number" ? o.age : Number(o.age);
  const roomRaw = o.room;
  const wwRaw = o.ww;
  const labRaw = o.lab;
  const burnRaw = o.burn;
  const notesRaw = o.notes;
  let ww = false;
  let lab = false;
  let burn = false;
  let room: "room1" | "room2" = "room1";
  let notes = "";
  if (typeof wwRaw === "boolean") {
    ww = wwRaw;
  } else if (typeof wwRaw === "string") {
    const s = wwRaw.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") ww = true;
    else if (s !== "") notes = wwRaw;
  }
  if (typeof labRaw === "boolean") lab = labRaw;
  else if (typeof labRaw === "string") {
    const s = labRaw.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") lab = true;
  }
  if (typeof burnRaw === "boolean") burn = burnRaw;
  else if (typeof burnRaw === "string") {
    const s = burnRaw.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes") burn = true;
  }
  if (typeof roomRaw === "string") {
    const s = roomRaw.trim().toLowerCase();
    if (s === "room1" || s === "room2") room = s as "room1" | "room2";
  }
  if (typeof notesRaw === "string" && notesRaw.trim()) notes = notesRaw.trim();
  return { id_no, sex, age: Number.isFinite(age) ? age : 0, room, ww, lab, burn, notes };
}

function readPending(): PendingCreate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingCreate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => ({
      ...row,
      payload: normalizePendingPayload(row.payload),
    }));
  } catch {
    return [];
  }
}

function writePending(items: PendingCreate[]) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(items));
}

/** Same calendar day as today (local), same trimmed id — blocks duplicate offline rows. */
function pendingHasSameIdToday(idNo: string): boolean {
  const day = todayYmd();
  const target = idNo.trim();
  for (const p of readPending()) {
    if (p.payload.id_no.trim() !== target) continue;
    const d = new Date(p.created_at);
    if (isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    if (`${y}-${m}-${dd}` === day) return true;
  }
  return false;
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
  const router = useRouter();
  const pathname = usePathname();
  // Fixed default on server + first client pass so SSR/static HTML matches hydration;
  // real preference is applied in useLayoutEffect (localStorage).
  const [theme, setTheme] = useState<"light" | "dark">("dark");
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
    room: "room1" | "room2";
    ww: boolean;
    lab: boolean;
    burn: boolean;
    notes: string;
  }>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<null | { id: number; idNo: string }>(null);
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [tableNotice, setTableNotice] = useState<string | null>(null);

  const [form, setForm] = useState({
    id_no: "",
    sex: "M" as Sex,
    age: "",
    room: "room1" as "room1" | "room2",
    ww: false,
    lab: false,
    burn: false,
    notes: "",
  });

  const [idSearch, setIdSearch] = useState("");
  const [dateRange, setDateRange] = useState<{ from_date: string; to_date: string }>({
    from_date: "",
    to_date: "",
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
    room: "room1" | "room2";
    ww: boolean;
    lab: boolean;
    burn: boolean;
    notes: string;
  }>(null);
  const [pendingSaving, setPendingSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [sort, setSort] = useState<{
    key: "id_no" | "sex" | "age" | "room" | "created_at" | "ww" | "lab" | "burn" | "notes";
    dir: "asc" | "desc";
  }>({ key: "created_at", dir: "desc" });

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [auditOpen, setAuditOpen] = useState<null | { patient: Patient; logs: PatientAuditLog[] }>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [createUserForm, setCreateUserForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "nurse" as AdminUserRow["role"],
  });

  const [userEditing, setUserEditing] = useState<null | AdminUserRow>(null);
  const [userEditForm, setUserEditForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "nurse" as AdminUserRow["role"],
    is_active: true,
  });
  const [userEditSaving, setUserEditSaving] = useState(false);

  const [userDelete, setUserDelete] = useState<null | AdminUserRow>(null);
  const [userDeleteSaving, setUserDeleteSaving] = useState(false);

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
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("theme", theme);
  }, [theme]);

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
        if (!cancelled) setAuthUser(u);
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

  useEffect(() => {
    if (!authReady || !authUser) return;
    const doctor = isDoctorRole(authUser.role);
    if (doctor && pathname !== "/doctor") {
      router.replace("/doctor");
      return;
    }
    if (!doctor && pathname === "/doctor") {
      router.replace("/");
    }
  }, [authReady, authUser, pathname, router]);

  const isDoctorSection = pathname === "/doctor";
  const manageableRoleOptions = useMemo<Array<{ value: AdminUserRow["role"]; label: string }>>(() => {
    if (!authUser) return [] as Array<{ value: AdminUserRow["role"]; label: string }>;
    if (authUser.role === "admin") {
      return isDoctorSection
        ? [
            { value: "doctor", label: "doctor" },
            { value: "doctor_admin", label: "doctor_admin" },
          ]
        : [
            { value: "nurse", label: "nurse" },
            { value: "nurse_admin", label: "nurse_admin" },
          ];
    }
    if (authUser.role === "doctor_admin") {
      return [
        { value: "doctor", label: "doctor" },
        { value: "doctor_admin", label: "doctor_admin" },
      ];
    }
    if (authUser.role === "nurse_admin") {
      return [
        { value: "nurse", label: "nurse" },
        { value: "nurse_admin", label: "nurse_admin" },
      ];
    }
    return [];
  }, [authUser, isDoctorSection]);

  useEffect(() => {
    if (manageableRoleOptions.length === 0) return;
    const allowed = manageableRoleOptions.some((opt) => opt.value === createUserForm.role);
    if (!allowed) {
      setCreateUserForm((prev) => ({ ...prev, role: manageableRoleOptions[0].value }));
    }
  }, [createUserForm.role, manageableRoleOptions]);

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
      setPatients([]);
      setTotalPatients(null);
      if (e instanceof TypeError) {
        setError(
          "No server connection. The app works; new entries can be saved offline and will sync when online."
        );
        return null;
      }
      const msg = e instanceof Error ? e.message : "Failed to load data";
      setError(msg);
      showToast("error", msg);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady || !getAuthToken()) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, effectiveFilters.id_no, effectiveFilters.from_date, effectiveFilters.to_date, effectiveFilters.date]);

  useEffect(() => {
    // When exiting filters UI, clear filters from the table view.
    if (filtersOpen) return;
    if (!authReady || !getAuthToken()) return;
    setIdSearch("");
    setDateRange({ from_date: "", to_date: "" });
    setFiltersApplied(false);
    void refresh({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, filtersOpen]);

  async function flushPendingCreates() {
    if (typeof window === "undefined") return;
    if (!getAuthToken()) return;
    if (!navigator.onLine) return;
    const items = readPending();
    if (items.length === 0) return;

    const remaining: PendingCreate[] = [];
    for (const item of items) {
      try {
        await createPatient(item.payload);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("already registered today")) {
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
    if (!authReady || !getAuthToken()) return;
    setPendingCount(readPending().length);
    void flushPendingCreates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  useEffect(() => {
    function onOnline() {
      if (!authReady || !getAuthToken()) return;
      void flushPendingCreates();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

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

      if (pendingHasSameIdToday(idNo)) {
        showToast("error", "This ID is already saved for today (pending offline list).");
        return;
      }

      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const dupToday = await listPatients({ id_no_exact: idNo, date: todayYmd() });
          if (dupToday.length > 0) {
            showToast("error", "This ID number is already registered today.");
            return;
          }
        } catch {
          /* server unreachable — backend will enforce when online */
        }
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
        room: form.room,
        ww: form.ww,
        lab: form.lab,
        burn: form.burn,
        notes: form.notes.trim(),
      };

      if (typeof window !== "undefined" && !navigator.onLine) {
        const next: PendingCreate[] = [
          ...readPending(),
          { id: crypto.randomUUID(), payload, created_at: new Date().toISOString() },
        ];
        writePending(next);
        setPendingCount(next.length);
        setForm((p) => ({
          ...p,
          id_no: "",
          age: "",
          room: "room1",
          ww: false,
          lab: false,
          burn: false,
          notes: "",
        }));
        showToast("success", "Saved offline. Will sync when online.");
        return;
      }

      try {
        await createPatient({
          id_no: payload.id_no,
          sex: payload.sex,
          age: payload.age,
          room: payload.room,
          ww: payload.ww,
          lab: payload.lab,
          burn: payload.burn,
          notes: payload.notes || null,
        });
      } catch (e) {
        // Network failure → queue for later
        if (e instanceof TypeError || !navigator.onLine) {
          const next: PendingCreate[] = [
            ...readPending(),
            { id: crypto.randomUUID(), payload, created_at: new Date().toISOString() },
          ];
          writePending(next);
          setPendingCount(next.length);
          setForm((p) => ({
            ...p,
            id_no: "",
            age: "",
            room: "room1",
            ww: false,
            lab: false,
            burn: false,
            notes: "",
          }));
          showToast("success", "Saved offline. Will sync when online.");
          return;
        }
        throw e;
      }
      setForm((p) => ({
        ...p,
        id_no: "",
        age: "",
        room: "room1",
        ww: false,
        lab: false,
        burn: false,
        notes: "",
      }));
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

  async function openAudits(patient: Patient) {
    if (!authUser || !isSectionAdmin(authUser.role)) return;
    setAuditLoading(true);
    try {
      const logs = await getPatientAudits(patient.id);
      setAuditOpen({ patient, logs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load audit log";
      showToast("error", msg);
    } finally {
      setAuditLoading(false);
    }
  }

  async function reloadAdminUsers() {
    const users = await listUsers();
    setAdminUsers(users);
  }

  async function openAdmin() {
    setAdminError(null);
    setAdminLoading(true);
    try {
      await reloadAdminUsers();
      setAdminOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load users";
      setAdminError(msg);
      showToast("error", msg);
    } finally {
      setAdminLoading(false);
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
      if (sort.key === "ww") return (Number(av) - Number(bv)) * dirMul;
      if (sort.key === "lab") return (Number(av) - Number(bv)) * dirMul;
      if (sort.key === "burn") return (Number(av) - Number(bv)) * dirMul;
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
    if (!authReady || !getAuthToken()) return;
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

  if (!authReady || !authUser) {
    return (
      <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            Loading…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <PwaClient />

        {auditOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="Patient audit log"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setAuditOpen(null)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0 sm:max-h-[85vh] sm:overflow-hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Audit log — ID {auditOpen.patient.id_no}
                </div>
                <button
                  type="button"
                  onClick={() => setAuditOpen(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Close
                </button>
              </div>

              {auditOpen.logs.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-300">No audit entries.</div>
              ) : (
                <div className="max-h-[70vh] overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800 sm:max-h-full">
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="text-left font-semibold text-zinc-700 dark:text-zinc-200">
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">When</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">User</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Action</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditOpen.logs.map((l) => (
                        <tr key={l.id} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-300">
                            {new Date(l.created_at).toLocaleString()}
                          </td>
                          <td className="px-3 py-2">{l.username ?? "—"}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex rounded-md bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                              {l.action}
                            </span>
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-950">
                              <PatientAuditDetails log={l} />
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

        {adminOpen ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
            role="dialog"
            aria-modal="true"
            aria-label="Admin user management"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setAdminOpen(false)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0 sm:max-h-[85vh] sm:overflow-hidden">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Admin — Users
                </div>
                <button
                  type="button"
                  onClick={() => setAdminOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Close
                </button>
              </div>

              <div className="grid max-h-[80vh] grid-cols-1 gap-3 overflow-auto lg:max-h-full lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                      Create user
                    </div>
                    <div className="space-y-2">
                      <input
                        value={createUserForm.name}
                        onChange={(e) => setCreateUserForm((p) => ({ ...p, name: e.target.value }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                        placeholder="Name"
                      />
                      <input
                        value={createUserForm.username}
                        onChange={(e) => setCreateUserForm((p) => ({ ...p, username: e.target.value }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                        placeholder="Username"
                      />
                      <input
                        value={createUserForm.password}
                        onChange={(e) => setCreateUserForm((p) => ({ ...p, password: e.target.value }))}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                        placeholder="Password"
                        type="password"
                      />
                      <select
                        value={createUserForm.role}
                        onChange={(e) =>
                          setCreateUserForm((p) => ({ ...p, role: e.target.value as AdminUserRow["role"] }))
                        }
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                      >
                        {manageableRoleOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        disabled={adminLoading}
                        onClick={async () => {
                          setAdminError(null);
                          setAdminLoading(true);
                          try {
                            await createUser({
                              name: createUserForm.name.trim(),
                              username: createUserForm.username.trim(),
                              password: createUserForm.password,
                              role: createUserForm.role,
                            });
                            await reloadAdminUsers();
                            setCreateUserForm((prev) => ({
                              name: "",
                              username: "",
                              password: "",
                              role: manageableRoleOptions[0]?.value ?? prev.role,
                            }));
                            showToast("success", "User created.");
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : "Create failed";
                            setAdminError(msg);
                            showToast("error", msg);
                          } finally {
                            setAdminLoading(false);
                          }
                        }}
                        className="w-full rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {adminLoading ? "Working..." : "Create"}
                      </button>

                      {adminError ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">
                          {adminError}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-3">
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                    <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">
                      Users ({adminUsers.length})
                    </div>
                    <div className="max-h-[55vh] overflow-auto">
                      <table className="w-full border-separate border-spacing-0 text-xs">
                        <thead>
                          <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                            <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Username</th>
                            <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Name</th>
                            <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Role</th>
                            <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Status</th>
                            <th className="sticky top-0 bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/60">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUsers.map((u) => (
                            <tr key={u.id} className="border-t border-zinc-200 dark:border-zinc-800">
                              <td className="px-3 py-2 font-semibold">{u.username}</td>
                              <td className="px-3 py-2">{u.name}</td>
                              <td className="px-3 py-2">
                                <span className="inline-flex rounded-md bg-zinc-100 px-2 py-0.5 font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                                  {u.role}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`inline-flex rounded-md px-2 py-0.5 font-semibold ${
                                    u.is_active
                                      ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100"
                                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                                  }`}
                                >
                                  {u.is_active ? "Active" : "Disabled"}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex justify-end gap-1">
                                  <button
                                    type="button"
                                    disabled={adminLoading}
                                    onClick={() => {
                                      setUserEditing(u);
                                      setUserEditForm({
                                        name: u.name,
                                        username: u.username,
                                        email: u.email ?? "",
                                        password: "",
                                        role: u.role,
                                        is_active: Boolean(u.is_active),
                                      });
                                    }}
                                    className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-60 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                    title="Edit user"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={adminLoading || u.id === authUser.id}
                                    onClick={async () => {
                                      setAdminError(null);
                                      setAdminLoading(true);
                                      try {
                                        await updateUser(u.id, { is_active: !u.is_active });
                                        await reloadAdminUsers();
                                        showToast("success", u.is_active ? "User disabled." : "User enabled.");
                                      } catch (e) {
                                        const msg = e instanceof Error ? e.message : "Update failed";
                                        setAdminError(msg);
                                        showToast("error", msg);
                                      } finally {
                                        setAdminLoading(false);
                                      }
                                    }}
                                    className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-60 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                    title={u.is_active ? "Disable user" : "Enable user"}
                                  >
                                    <Ban className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={adminLoading || u.id === authUser.id}
                                    onClick={() => setUserDelete(u)}
                                    className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-60 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                    title="Delete user"
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
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {userEditing ? (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Edit user"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setUserEditing(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Edit user</div>
                <button
                  type="button"
                  onClick={() => setUserEditing(null)}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Close
                </button>
              </div>

              <div className="space-y-2">
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Name</label>
                  <input
                    value={userEditForm.name}
                    onChange={(e) => setUserEditForm((p) => ({ ...p, name: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Username</label>
                  <input
                    value={userEditForm.username}
                    onChange={(e) => setUserEditForm((p) => ({ ...p, username: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Email (optional)</label>
                  <input
                    value={userEditForm.email}
                    onChange={(e) => setUserEditForm((p) => ({ ...p, email: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Leave empty for no email"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">New password (optional)</label>
                  <input
                    value={userEditForm.password}
                    onChange={(e) => setUserEditForm((p) => ({ ...p, password: e.target.value }))}
                    type="password"
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Leave empty to keep current password"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Role</label>
                    <select
                      value={userEditForm.role}
                      onChange={(e) =>
                        setUserEditForm((p) => ({ ...p, role: e.target.value as AdminUserRow["role"] }))
                      }
                      disabled={
                        (userEditing.id === authUser.id && isSectionAdmin(userEditing.role)) ||
                        manageableRoleOptions.length === 0
                      }
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    >
                      {manageableRoleOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex w-full items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
                      <span>Active</span>
                      <input
                        type="checkbox"
                        checked={userEditForm.is_active}
                        disabled={userEditing.id === authUser.id}
                        onChange={(e) => setUserEditForm((p) => ({ ...p, is_active: e.target.checked }))}
                        className="h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setUserEditing(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={userEditSaving}
                  onClick={async () => {
                    if (!userEditing) return;
                    if (userEditing.id === authUser.id && userEditForm.is_active === false) {
                      showToast("error", "You cannot disable your own account.");
                      return;
                    }
                    if (
                      userEditing.id === authUser.id &&
                      isSectionAdmin(userEditing.role) &&
                      userEditForm.role !== userEditing.role
                    ) {
                      showToast("error", "You cannot demote your own section admin account here.");
                      return;
                    }

                    setUserEditSaving(true);
                    try {
                      const nextEmail = userEditForm.email.trim();
                      const payload: Parameters<typeof updateUser>[1] = {
                        name: userEditForm.name.trim(),
                        username: userEditForm.username.trim(),
                        email: nextEmail ? nextEmail : null,
                        role: userEditForm.role,
                        is_active: userEditForm.is_active,
                      };
                      if (userEditForm.password.trim()) {
                        payload.password = userEditForm.password.trim();
                      }

                      const sameName = payload.name === userEditing.name;
                      const sameUsername = payload.username === userEditing.username;
                      const sameEmail = (userEditing.email ?? "") === (payload.email ?? "");
                      const sameRole = payload.role === userEditing.role;
                      const sameActive = payload.is_active === Boolean(userEditing.is_active);
                      const pwd = Boolean(userEditForm.password.trim());
                      if (sameName && sameUsername && sameEmail && sameRole && sameActive && !pwd) {
                        showToast("error", "No changes to save.");
                        return;
                      }

                      await updateUser(userEditing.id, payload);
                      await reloadAdminUsers();

                      if (userEditing.id === authUser.id) {
                        const u = await fetchCurrentUser();
                        setAuthUser(u);
                      }

                      setUserEditing(null);
                      showToast("success", "User updated.");
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Update failed";
                      showToast("error", msg);
                    } finally {
                      setUserEditSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {userEditSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {userDelete ? (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete user"
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setUserDelete(null)}
              aria-label="Close"
            />
            <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Delete user</div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Are you sure you want to delete{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-50">{userDelete.username}</span>?
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setUserDelete(null)}
                  className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:active:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={userDeleteSaving}
                  onClick={async () => {
                    if (!userDelete) return;
                    setUserDeleteSaving(true);
                    try {
                      await deleteUser(userDelete.id);
                      await reloadAdminUsers();
                      setUserDelete(null);
                      showToast("success", "User deleted.");
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : "Delete failed";
                      showToast("error", msg);
                    } finally {
                      setUserDeleteSaving(false);
                    }
                  }}
                  className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {userDeleteSaving ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Room</label>
                  <select
                    value={pendingEditing.room}
                    onChange={(e) =>
                      setPendingEditing((p) =>
                        p ? { ...p, room: e.target.value as "room1" | "room2" } : p
                      )
                    }
                    aria-label="Room"
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  >
                    <option value="room1">room1</option>
                    <option value="room2">room2</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  id="pending-ww"
                  type="checkbox"
                  checked={pendingEditing.ww}
                  onChange={(e) =>
                    setPendingEditing((p) => (p ? { ...p, ww: e.target.checked } : p))
                  }
                  className="h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="pending-ww" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  WW
                </label>

                <input
                  id="pending-lab"
                  type="checkbox"
                  checked={pendingEditing.lab}
                  onChange={(e) =>
                    setPendingEditing((p) => (p ? { ...p, lab: e.target.checked } : p))
                  }
                  className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="pending-lab" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Lab
                </label>

                <input
                  id="pending-burn"
                  type="checkbox"
                  checked={pendingEditing.burn}
                  onChange={(e) =>
                    setPendingEditing((p) => (p ? { ...p, burn: e.target.checked } : p))
                  }
                  className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="pending-burn" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Burn
                </label>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Notes</label>
                <textarea
                  value={pendingEditing.notes}
                  onChange={(e) =>
                    setPendingEditing((p) => (p ? { ...p, notes: e.target.value } : p))
                  }
                  className="mt-1 min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  placeholder="Optional notes"
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
                                room: pendingEditing.room,
                                ww: pendingEditing.ww,
                                lab: pendingEditing.lab,
                                burn: pendingEditing.burn,
                                notes: pendingEditing.notes.trim(),
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
                        <th className="bg-zinc-100 px-3 py-2 text-center dark:bg-zinc-800/60">#</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">ID No</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Sex</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Age</th>
                      <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Room</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">WW</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Lab</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Burn</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Notes</th>
                        <th className="bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Saved at</th>
                        <th className="bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/60">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((it, idx) => (
                        <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="px-3 py-2 text-center tabular-nums text-zinc-500 dark:text-zinc-400">
                            {idx + 1}
                          </td>
                          <td className="px-3 py-2 font-medium">{it.payload.id_no}</td>
                          <td className="px-3 py-2">{it.payload.sex}</td>
                          <td className="px-3 py-2">{it.payload.age}</td>
                        <td className="px-3 py-2">{it.payload.room}</td>
                          <td className="px-3 py-2">
                            <WarBoolCell value={it.payload.ww} />
                          </td>
                          <td className="px-3 py-2">
                            <WarBoolCell value={it.payload.lab} />
                          </td>
                          <td className="px-3 py-2">
                            <WarBoolCell value={it.payload.burn} />
                          </td>
                          <td className="px-3 py-2 max-w-[140px] truncate" title={it.payload.notes}>
                            {it.payload.notes || "—"}
                          </td>
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
                                    room: it.payload.room,
                                    ww: it.payload.ww,
                                    lab: it.payload.lab,
                                    burn: it.payload.burn,
                                    notes: it.payload.notes ?? "",
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
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Room
                  </label>
                  <select
                    value={editing.room}
                    onChange={(e) =>
                      setEditing((p) => (p ? { ...p, room: e.target.value as "room1" | "room2" } : p))
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    title="Room"
                  >
                    <option value="room1">room1</option>
                    <option value="room2">room2</option>
                  </select>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <input
                  id="edit-ww"
                  type="checkbox"
                  checked={editing.ww}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, ww: e.target.checked } : p))
                  }
                  className="h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="edit-ww" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  WW
                </label>

                <input
                  id="edit-lab"
                  type="checkbox"
                  checked={editing.lab}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, lab: e.target.checked } : p))
                  }
                  className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="edit-lab" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Lab
                </label>

                <input
                  id="edit-burn"
                  type="checkbox"
                  checked={editing.burn}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, burn: e.target.checked } : p))
                  }
                  className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                />
                <label htmlFor="edit-burn" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  Burn
                </label>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Notes</label>
                <textarea
                  value={editing.notes}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, notes: e.target.value } : p))
                  }
                  className="mt-1 min-h-[96px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                  placeholder="Optional notes"
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
                        room: editing.room,
                        ww: editing.ww,
                        lab: editing.lab,
                        burn: editing.burn,
                        notes: editing.notes.trim() ? editing.notes.trim() : null,
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Surgical Dressing Log
            </h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {authUser ? (
              <div className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <span className="font-semibold">{authUser.username}</span>
                {isSectionAdmin(authUser.role) ? (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
                    <Shield className="h-3 w-3" /> admin
                  </span>
                ) : null}
                {isSectionAdmin(authUser.role) ? (
                  <button
                    type="button"
                    onClick={() => void openAdmin()}
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
                    setPatients([]);
                    setTotalPatients(null);
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
                  disabled={!authUser}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-600 px-2 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-600 dark:hover:bg-slate-500 dark:active:bg-slate-700 dark:focus-visible:ring-slate-500 dark:focus-visible:ring-offset-zinc-950"
                >
                  <Download className="h-4 w-4" />
                  Export Excel
                </button>
              </div>
            ) : null}
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
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Room
                    </label>
                    <select
                      value={form.room}
                      onChange={(e) => setForm((p) => ({ ...p, room: e.target.value as "room1" | "room2" }))}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                      title="Room"
                    >
                      <option value="room1">room1</option>
                      <option value="room2">room2</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id="form-ww"
                    type="checkbox"
                    checked={form.ww}
                    onChange={(e) => setForm((p) => ({ ...p, ww: e.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                  />
                  <label htmlFor="form-ww" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    WW
                  </label>

                  <input
                    id="form-lab"
                    type="checkbox"
                    checked={form.lab}
                    onChange={(e) => setForm((p) => ({ ...p, lab: e.target.checked }))}
                    className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                  />
                  <label htmlFor="form-lab" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    Lab
                  </label>

                  <input
                    id="form-burn"
                    type="checkbox"
                    checked={form.burn}
                    onChange={(e) => setForm((p) => ({ ...p, burn: e.target.checked }))}
                    className="ml-3 h-4 w-4 rounded border-zinc-300 text-slate-600 focus:ring-slate-500 dark:border-zinc-600 dark:bg-zinc-950"
                  />
                  <label htmlFor="form-burn" className="text-xs font-medium text-zinc-700 dark:text-zinc-200">
                    Burn
                  </label>
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Notes (optional)
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                    className="mt-1 min-h-[84px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none shadow-sm focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:focus:border-zinc-600"
                    placeholder="Optional notes"
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
                      <th className="sticky top-0 w-[56px] bg-zinc-100 px-2 py-2 text-center dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        #
                      </th>
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
                      <th className="sticky top-0 w-[92px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("room")}
                          className="inline-flex items-center gap-1"
                          title="Room"
                        >
                          Room <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 w-[72px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:w-[80px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("ww")}
                          className="inline-flex items-center gap-1"
                          title="WW"
                        >
                          WW <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 w-[72px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:w-[80px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("lab")}
                          className="inline-flex items-center gap-1"
                          title="Lab"
                        >
                          Lab <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 w-[80px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:w-[88px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("burn")}
                          className="inline-flex items-center gap-1"
                          title="Burn"
                        >
                          Burn <span className="text-zinc-400">⇅</span>
                        </button>
                      </th>
                      <th className="sticky top-0 min-w-[100px] bg-zinc-100 px-2 py-2 dark:bg-zinc-800/60 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                        <button
                          type="button"
                          onClick={() => toggleSort("notes")}
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
                    {pagedPatients.map((p, idx) => {
                      const serial = (safePage - 1) * pageSize + idx + 1;
                      return (
                        <tr
                          key={p.id}
                          className="border-t border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                        >
                          <td className="w-[56px] px-2 py-2 align-top text-center tabular-nums text-zinc-500 sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800 dark:text-zinc-400">
                            {serial}
                          </td>
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
                          <td className="w-[92px] px-2 py-2 align-top sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <span className="inline-flex rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                              {p.room ?? "—"}
                            </span>
                          </td>
                          <td className="w-[72px] px-2 py-2 align-top sm:w-[80px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <WarBoolCell value={Boolean(p.ww)} />
                          </td>
                          <td className="w-[72px] px-2 py-2 align-top sm:w-[80px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <WarBoolCell value={Boolean(p.lab)} />
                          </td>
                          <td className="w-[80px] px-2 py-2 align-top sm:w-[88px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <WarBoolCell value={Boolean(p.burn)} />
                          </td>
                          <td className="min-w-[100px] px-2 py-2 align-top sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <NotesPreview value={p.notes ?? null} />
                          </td>
                          <td className="w-[84px] px-2 py-2 align-top sm:w-[104px] sm:px-4 sm:py-3 border-r border-zinc-200 dark:border-zinc-800">
                            <div className="flex justify-end gap-2 whitespace-nowrap text-zinc-700 dark:text-zinc-200">
                              {isSectionAdmin(authUser.role) ? (
                                <button
                                  type="button"
                                  disabled={auditLoading}
                                  onClick={() => void openAudits(p)}
                                  title="Audit log (admin only)"
                                  className="rounded-md p-1 transition-colors hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-60 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
                                >
                                  📜
                                </button>
                              ) : null}
                              <button
                                type="button"
                                onClick={async () => {
                                  setEditing({
                                    id: p.id,
                                    id_no: p.id_no ?? "",
                                    sex: p.sex,
                                    age: String(p.age ?? ""),
                                    room: (p.room ?? "room1") as "room1" | "room2",
                                    ww: Boolean(p.ww),
                                    lab: Boolean(p.lab),
                                    burn: Boolean(p.burn),
                                    notes: p.notes ?? "",
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
                          colSpan={8}
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

        <div className="mt-8 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <div className="font-medium text-zinc-700 dark:text-zinc-300">
            المهندسة لما أحمد الدربي
          </div>
          <a
            className="mt-1 inline-flex items-center justify-center underline underline-offset-4 hover:text-zinc-900 dark:hover:text-zinc-100"
            href="mailto:lamaadirbi@gmail.com"
          >
            lamaadirbi@gmail.com
          </a>
        </div>
      </div>
    </div>
  );
}
