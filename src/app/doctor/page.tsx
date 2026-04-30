"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, logout } from "@/lib/authApi";
import { PwaClient } from "@/components/PwaClient";
import { getAuthToken, setAuthToken, type AuthUser } from "@/lib/auth";
import {
  createPatient,
  deletePatient,
  getPatientsCount,
  listPatients,
  updatePatient,
  type Patient,
  type Sex,
} from "@/lib/patientsApi";
import { createUser, deleteUser, listUsers, updateUser, type AdminUserRow } from "@/lib/usersApi";
import { isDoctorRole, isSectionAdmin } from "@/lib/roleRouting";
import { exportStyledExcel } from "@/lib/excelExport";
import { Download, LogOut, Moon, Plus, Shield, Sun } from "lucide-react";

type Disposition = "discharged" | "admitted" | "referred_ed" | "referred_out";
type AgeRange = "lt5" | "5to14" | "15to17" | "gte18";
type InfectionChoice =
  | "acute_viral_hepatitis"
  | "mumps"
  | "chicken_pox"
  | "measles"
  | "menningits"
  | "other";

type PendingDoctorCreate = {
  id: string;
  payload: {
    id_no: string;
    sex: Sex;
    ageRange: AgeRange;
    selectedDx: number[];
    infectionChoice: InfectionChoice | "";
    infectionOtherText: string;
    ww: boolean;
    disposition: Disposition;
  };
  created_at: string;
};

const DIAGNOSES = [
  { no: 1, name: "Respiratory Tract Infection", category: "Medical" },
  { no: 2, name: "Acute Watery Diarrhea", category: "Medical" },
  { no: 3, name: "Acute Bloody Diarrhea", category: "Medical" },
  { no: 4, name: "Infections Disease", category: "Medical" },
  { no: 5, name: "Other GI Diseases", category: "Medical" },
  { no: 6, name: "Scabies", category: "Medical" },
  { no: 7, name: "Skin Infection", category: "Medical" },
  { no: 8, name: "Other Skin Diseases", category: "Medical" },
  { no: 9, name: "Genitourinary Diseases", category: "Medical" },
  { no: 10, name: "Musculoskeletal Diseases", category: "Medical" },
  { no: 11, name: "Hypertension", category: "Medical" },
  { no: 12, name: "Diabetes", category: "Medical" },
  { no: 13, name: "Epilepsy", category: "Medical" },
  { no: 14, name: "Eye Diseases", category: "Medical" },
  { no: 15, name: "ENT Diseases", category: "Medical" },
  { no: 16, name: "Other Medical Diseases", category: "Medical" },
  { no: 17, name: "Fracture", category: "Surgical" },
  { no: 18, name: "Burn", category: "Surgical" },
  { no: 19, name: "Gunshot Wound (GSW)", category: "Surgical" },
  { no: 20, name: "Other Wound", category: "Surgical" },
  { no: 21, name: "Other Surgical", category: "Surgical" },
  { no: 22, name: "Dental", category: "Medical" },
] as const;
const DOCTOR_PENDING_KEY = "doctorPendingPatientCreates";
const DATE_INPUT_CLASS =
  "min-w-[138px] rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium tabular-nums text-zinc-800 shadow-sm outline-none transition-colors [direction:ltr] text-left focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark] dark:focus:border-slate-400 dark:focus:ring-slate-800";

function formatYmdForDisplay(ymd: string) {
  const s = (ymd ?? "").trim();
  if (!s) return "Select date";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function DatePickerField({
  label,
  value,
  onChange,
  title,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  title: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{label}</span>
      <button
        type="button"
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (el as any).showPicker?.();
          el.focus();
          el.click();
        }}
        className="flex min-w-[138px] items-center justify-between gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-left text-xs font-medium tabular-nums text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
        title={title}
      >
        <span>{formatYmdForDisplay(value)}</span>
        <span className="text-zinc-400" aria-hidden="true">
          📅
        </span>
      </button>
      <input
        ref={ref}
        type="date"
        lang="en-CA"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-label={title}
      />
    </div>
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function ymdFromDate(dt: Date) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

function startOfWeekSaturday(refYmd: string) {
  const [y, m, d] = refYmd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  const dow = dt.getDay(); // 0=Sun ... 6=Sat
  const daysSinceSaturday = (dow - 6 + 7) % 7;
  dt.setDate(dt.getDate() - daysSinceSaturday);
  return ymdFromDate(dt);
}

function parseDoctorNotes(notes: string | null) {
  const raw = notes ?? "";
  const parts = raw.split("|").map((x) => x.trim());
  const dxNoPart = parts.find((p) => p.startsWith("dx_no:")) ?? "";
  const dxPart = parts.find((p) => p.startsWith("dx:")) ?? "";
  const catPart = parts.find((p) => p.startsWith("cat:")) ?? "";
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
    cat: catPart.replace(/^cat:/, "").trim(),
    disposition: dispositionPart.replace(/^disposition:/, "").trim(),
    custom: customPart.replace(/^custom:/, "").trim(),
  };
}

function readDoctorPending(): PendingDoctorCreate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(DOCTOR_PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingDoctorCreate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDoctorPending(items: PendingDoctorCreate[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DOCTOR_PENDING_KEY, JSON.stringify(items));
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
  const [summaryRows, setSummaryRows] = useState<Patient[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryLabel, setSummaryLabel] = useState("Today");
  const [summaryMode, setSummaryMode] = useState<"date" | "range">("date");
  const [summaryDate, setSummaryDate] = useState(todayYmd());
  const [summaryFrom, setSummaryFrom] = useState(todayYmd());
  const [summaryTo, setSummaryTo] = useState(todayYmd());
  const [summaryExporting, setSummaryExporting] = useState(false);
  const [tableMode, setTableMode] = useState<"daily" | "weekly" | "monthly" | "range">("daily");
  const [tableRefDate, setTableRefDate] = useState(todayYmd());
  const [tableFromDate, setTableFromDate] = useState(todayYmd());
  const [tableToDate, setTableToDate] = useState(todayYmd());
  const [tableCreator, setTableCreator] = useState("all");
  const [tableMineOnly, setTableMineOnly] = useState(false);
  const [showRegisteredCasesTotal, setShowRegisteredCasesTotal] = useState(false);
  const [registeredCasesTotal, setRegisteredCasesTotal] = useState<number | null>(null);
  const [registeredCasesLoading, setRegisteredCasesLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [tableExporting, setTableExporting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [pendingItems, setPendingItems] = useState<PendingDoctorCreate[]>([]);
  const [editingPatientId, setEditingPatientId] = useState<number | null>(null);
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [deletingPatientId, setDeletingPatientId] = useState<number | null>(null);
  const [deleteConfirmPatient, setDeleteConfirmPatient] = useState<Patient | null>(null);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [deletingAllCases, setDeletingAllCases] = useState(false);

  const [patientId, setPatientId] = useState("");
  const [sex, setSex] = useState<Sex>("M");
  const [ageRange, setAgeRange] = useState<AgeRange | "">("");
  const [keypadTarget, setKeypadTarget] = useState<"patientId">("patientId");
  const [selectedDx, setSelectedDx] = useState<number[]>([]);
  const [infectionChoice, setInfectionChoice] = useState<InfectionChoice | "">("");
  const [infectionOtherText, setInfectionOtherText] = useState("");
  const [ww, setWw] = useState(false);
  const [disposition, setDisposition] = useState<Disposition>("discharged");
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
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<"new" | "summary" | "tables">("new");
  const hasSelectedSurgical = selectedDx.some((no) => {
    const d = DIAGNOSES.find((x) => x.no === no);
    return d?.category === "Surgical";
  });
  const tableColSpan = canManageDoctorUsers ? 13 : 12;
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  function resetForm() {
    setPatientId("");
    setSex("M");
    setAgeRange("");
    setSelectedDx([]);
    setInfectionChoice("");
    setInfectionOtherText("");
    setWw(false);
    setDisposition("discharged");
    setEditingPatientId(null);
  }

  function ageToRange(age: number): AgeRange {
    if (age <= 4) return "lt5";
    if (age <= 14) return "5to14";
    if (age <= 17) return "15to17";
    return "gte18";
  }

  function applyKeypadInput(value: string) {
    const apply = (current: string, setter: (next: string) => void) => {
      if (value === "CLR") {
        setter("");
        return;
      }
      if (value === "⌫") {
        setter(current.slice(0, -1));
        return;
      }
      setter(`${current}${value}`);
    };

    apply(patientId, setPatientId);
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
      setSummaryRows(data);
      setSummaryLabel("Today");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  function currentTableRange(): { from: string; to: string } {
    if (tableMode === "daily") {
      const d = tableRefDate || todayYmd();
      return { from: d, to: d };
    }
    if (tableMode === "weekly") {
      const d = tableRefDate || todayYmd();
      return { from: startOfWeekSaturday(d), to: d };
    }
    if (tableMode === "monthly") {
      const d = tableRefDate || todayYmd();
      const [y, m] = d.split("-").map(Number);
      return { from: `${y}-${pad2(m ?? 1)}-01`, to: d };
    }
    return { from: tableFromDate || todayYmd(), to: tableToDate || todayYmd() };
  }

  async function applyTableFilters() {
    const { from, to } = currentTableRange();
    setTableLoading(true);
    setError(null);
    try {
      const data = await listPatients({ from_date: from, to_date: to });
      const creatorFilter =
        authUser?.role === "doctor_admin"
          ? tableCreator
          : tableMineOnly
            ? authUser?.username ?? "__none__"
            : "all";
      const filtered =
        creatorFilter === "all"
          ? data
          : data.filter((r) => (r.created_by ?? "").trim() === creatorFilter);
      setRows(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply filters.");
    } finally {
      setTableLoading(false);
    }
  }

  function buildDoctorPayloadFromForm() {
    const id = patientId.trim();
    const ageNum = (() => {
      if (ageRange === "lt5") return 4;
      if (ageRange === "5to14") return 10;
      if (ageRange === "15to17") return 16;
      if (ageRange === "gte18") return 18;
      return NaN;
    })();
    if (!id) throw new Error("Patient ID is required.");
    if (!Number.isFinite(ageNum)) throw new Error("Age range is required.");
    if (selectedDx.length === 0) throw new Error("Select at least one diagnosis.");
    if (selectedDx.includes(4) && !infectionChoice) {
      throw new Error("Please select infection disease type.");
    }
    if (selectedDx.includes(4) && infectionChoice === "other" && !infectionOtherText.trim()) {
      throw new Error("Please write the infection disease name in Other.");
    }

    const selectedDiagItems = DIAGNOSES.filter((d) => selectedDx.includes(d.no));
    const infectionLabel = (() => {
      if (infectionChoice === "acute_viral_hepatitis") return "Acute Viral Hepatitis";
      if (infectionChoice === "mumps") return "Mumps";
      if (infectionChoice === "chicken_pox") return "Chicken pox";
      if (infectionChoice === "measles") return "Measles";
      if (infectionChoice === "menningits") return "Menningits";
      if (infectionChoice === "other") return `Other: ${infectionOtherText.trim()}`;
      return "";
    })();
    const selectedDxNames = selectedDiagItems.map((d) =>
      d.no === 4 && infectionLabel ? `Infections Disease (${infectionLabel})` : d.name
    );
    const selectedDxNos = selectedDiagItems.map((d) => d.no);
    const hasMedicalCategory = selectedDiagItems.some((d) => d.category === "Medical");
    const categoryText = selectedDiagItems.every((d) => d.category === "Medical")
      ? "Medical"
      : selectedDiagItems.every((d) => d.category === "Surgical")
        ? "Surgical"
        : "Mixed";
    const notes = [`dx_no:${selectedDxNos.join(",")}`, `dx:${selectedDxNames.join(",")}`, `cat:${categoryText}`, `disposition:${disposition}`].join(" | ");
    const apiPayload = {
      id_no: id,
      sex,
      age: ageNum,
      room: hasMedicalCategory ? ("room2" as const) : ("room1" as const),
      ww,
      notes,
    };
    const pendingPayload: PendingDoctorCreate["payload"] = {
      id_no: id,
      sex,
      ageRange: ageRange as AgeRange,
      selectedDx: [...selectedDx],
      infectionChoice,
      infectionOtherText,
      ww,
      disposition,
    };
    return { apiPayload, pendingPayload };
  }

  function buildApiPayloadFromPendingPayload(payload: PendingDoctorCreate["payload"]) {
    const id = payload.id_no.trim();
    const ageNum = (() => {
      if (payload.ageRange === "lt5") return 4;
      if (payload.ageRange === "5to14") return 10;
      if (payload.ageRange === "15to17") return 16;
      if (payload.ageRange === "gte18") return 18;
      return NaN;
    })();
    if (!id) throw new Error("Patient ID is required.");
    if (!Number.isFinite(ageNum)) throw new Error("Age range is required.");
    if (payload.selectedDx.length === 0) throw new Error("Select at least one diagnosis.");
    if (payload.selectedDx.includes(4) && !payload.infectionChoice) {
      throw new Error("Please select infection disease type.");
    }
    if (payload.selectedDx.includes(4) && payload.infectionChoice === "other" && !payload.infectionOtherText.trim()) {
      throw new Error("Please write the infection disease name in Other.");
    }

    const selectedDiagItems = DIAGNOSES.filter((d) => payload.selectedDx.includes(d.no));
    const infectionLabel = (() => {
      if (payload.infectionChoice === "acute_viral_hepatitis") return "Acute Viral Hepatitis";
      if (payload.infectionChoice === "mumps") return "Mumps";
      if (payload.infectionChoice === "chicken_pox") return "Chicken pox";
      if (payload.infectionChoice === "measles") return "Measles";
      if (payload.infectionChoice === "menningits") return "Menningits";
      if (payload.infectionChoice === "other") return `Other: ${payload.infectionOtherText.trim()}`;
      return "";
    })();
    const selectedDxNames = selectedDiagItems.map((d) =>
      d.no === 4 && infectionLabel ? `Infections Disease (${infectionLabel})` : d.name
    );
    const selectedDxNos = selectedDiagItems.map((d) => d.no);
    const hasMedicalCategory = selectedDiagItems.some((d) => d.category === "Medical");
    const categoryText = selectedDiagItems.every((d) => d.category === "Medical")
      ? "Medical"
      : selectedDiagItems.every((d) => d.category === "Surgical")
        ? "Surgical"
        : "Mixed";
    const notes = [`dx_no:${selectedDxNos.join(",")}`, `dx:${selectedDxNames.join(",")}`, `cat:${categoryText}`, `disposition:${payload.disposition}`].join(" | ");
    return {
      id_no: id,
      sex: payload.sex,
      age: ageNum,
      room: hasMedicalCategory ? ("room2" as const) : ("room1" as const),
      ww: payload.ww,
      notes,
    };
  }

  async function flushPendingCreates() {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const items = readDoctorPending();
    if (items.length === 0) return;
    const remaining: PendingDoctorCreate[] = [];
    for (const it of items) {
      try {
        const apiPayload = buildApiPayloadFromPendingPayload(it.payload);
        await createPatient(apiPayload);
      } catch {
        remaining.push(it);
      }
    }
    writeDoctorPending(remaining);
    setPendingCount(remaining.length);
    setPendingItems(remaining);
    if (remaining.length !== items.length) {
      setToast("Pending doctor patients synced.");
      await refreshToday();
    }
  }

  function openPending() {
    const items = readDoctorPending();
    setPendingItems(items);
    setPendingOpen(true);
  }

  useEffect(() => {
    if (!authReady || !authUser) return;
    void refreshToday();
    setPendingCount(readDoctorPending().length);
    if (typeof navigator !== "undefined" && navigator.onLine) {
      void flushPendingCreates();
    }
  }, [authReady, authUser]);

  useEffect(() => {
    function onOnline() {
      void flushPendingCreates();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  useEffect(() => {
    if (!authReady || !authUser || activeSection !== "tables") return;
    if (showRegisteredCasesTotal) return;
    void applyTableFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, authUser, activeSection, tableMode, tableRefDate, tableFromDate, tableToDate, tableCreator, tableMineOnly, showRegisteredCasesTotal]);

  useEffect(() => {
    if (!authReady || !authUser || activeSection !== "summary") return;
    void generateSummaryReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, authUser, activeSection, summaryMode, summaryDate, summaryFrom, summaryTo]);

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

  useEffect(() => {
    if (!hasSelectedSurgical && ww) setWw(false);
  }, [hasSelectedSurgical, ww]);

  const stats = useMemo(() => {
    const total = summaryRows.length;
    const male = summaryRows.filter((r) => r.sex === "M").length;
    const female = summaryRows.filter((r) => r.sex === "F").length;
    const wwCount = summaryRows.filter((r) => r.ww).length;
    const nonWw = total - wwCount;
    const dxCounts = new Map<string, number>();
    for (const r of summaryRows) {
      const parsed = parseDoctorNotes(r.notes);
      for (const d of parsed.dx) {
        dxCounts.set(d, (dxCounts.get(d) ?? 0) + 1);
      }
    }
    const topDx = [...dxCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ageBreakdown = [
      { label: "0-4", match: (n: number) => n <= 4 },
      { label: "5-14", match: (n: number) => n >= 5 && n <= 14 },
      { label: "15-17", match: (n: number) => n >= 15 && n <= 17 },
      { label: ">=18", match: (n: number) => n >= 18 },
    ].map((g) => ({
      label: g.label,
      male: summaryRows.filter((r) => g.match(r.age) && r.sex === "M").length,
      female: summaryRows.filter((r) => g.match(r.age) && r.sex === "F").length,
    }));
    return { total, male, female, wwCount, nonWw, topDx, ageBreakdown };
  }, [summaryRows]);
  const orderedDiagnoses = useMemo(
    () =>
      [...DIAGNOSES].sort((a, b) => {
        const ca = a.category === "Medical" ? 0 : 1;
        const cb = b.category === "Medical" ? 0 : 1;
        if (ca !== cb) return ca - cb;
        return a.no - b.no;
      }),
    []
  );
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
    scrollToTop();
    setError(null);
    setSaving(true);
    try {
      const { apiPayload, pendingPayload } = buildDoctorPayloadFromForm();
      if (editingPatientId) {
        await updatePatient(editingPatientId, apiPayload);
      } else {
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          const next: PendingDoctorCreate[] = [
            ...readDoctorPending(),
            { id: crypto.randomUUID(), payload: pendingPayload, created_at: new Date().toISOString() },
          ];
          writeDoctorPending(next);
          setPendingCount(next.length);
          resetForm();
          setToast("Saved offline. Check Pending.");
          requestAnimationFrame(scrollToTop);
          return;
        }
        await createPatient(apiPayload);
      }
      resetForm();
      setToast(editingPatientId ? "Updated successfully." : "Saved successfully.");
      await refreshToday();
      requestAnimationFrame(scrollToTop);
    } catch (err) {
      if (!editingPatientId && (err instanceof TypeError || (typeof navigator !== "undefined" && !navigator.onLine))) {
        try {
          const { pendingPayload } = buildDoctorPayloadFromForm();
          const next: PendingDoctorCreate[] = [
            ...readDoctorPending(),
            { id: crypto.randomUUID(), payload: pendingPayload, created_at: new Date().toISOString() },
          ];
          writeDoctorPending(next);
          setPendingCount(next.length);
          resetForm();
          setToast("Saved offline. Check Pending.");
          requestAnimationFrame(scrollToTop);
          return;
        } catch {
          // fall through to generic error
        }
      }
      setError(err instanceof Error ? err.message : "Save failed.");
      requestAnimationFrame(scrollToTop);
    } finally {
      setSaving(false);
    }
  }

  function startEditPatient(row: Patient) {
    const parsed = parseDoctorNotes(row.notes);
    setEditingPatientId(row.id);
    setPatientId(row.id_no);
    setSex(row.sex);
    setAgeRange(ageToRange(row.age));
    setSelectedDx(parsed.dxNo.slice(0, 2));
    setWw(Boolean(row.ww));
    const disp = parsed.disposition as Disposition;
    setDisposition(
      disp === "discharged" || disp === "admitted" || disp === "referred_ed" || disp === "referred_out"
        ? disp
        : "discharged"
    );
    const inf = parsed.dx.find((x) => x.startsWith("Infections Disease ("));
    if (inf) {
      const val = inf.replace("Infections Disease (", "").replace(/\)$/, "").trim();
      if (val === "Acute Viral Hepatitis") setInfectionChoice("acute_viral_hepatitis");
      else if (val === "Mumps") setInfectionChoice("mumps");
      else if (val === "Chicken pox") setInfectionChoice("chicken_pox");
      else if (val === "Measles") setInfectionChoice("measles");
      else if (val === "Menningits") setInfectionChoice("menningits");
      else {
        setInfectionChoice("other");
        setInfectionOtherText(val.replace(/^Other:\s*/i, ""));
      }
    } else {
      setInfectionChoice("");
      setInfectionOtherText("");
    }
    setEditModalOpen(true);
  }

  function closeEditModal() {
    setEditModalOpen(false);
    setEditingPendingId(null);
    resetForm();
  }

  async function saveEditFromModal() {
    if (!editingPatientId && !editingPendingId) return;
    setError(null);
    setSaving(true);
    try {
      if (editingPendingId) {
        const nextPendingPayload: PendingDoctorCreate["payload"] = {
          id_no: patientId.trim(),
          sex,
          ageRange: ageRange as AgeRange,
          selectedDx: [...selectedDx],
          infectionChoice,
          infectionOtherText,
          ww,
          disposition,
        };
        buildApiPayloadFromPendingPayload(nextPendingPayload);
        const next = readDoctorPending().map((x) =>
          x.id === editingPendingId ? { ...x, payload: nextPendingPayload } : x
        );
        writeDoctorPending(next);
        setPendingItems(next);
        setPendingCount(next.length);
        setToast("Pending case updated.");
      } else if (editingPatientId) {
        const { apiPayload } = buildDoctorPayloadFromForm();
        await updatePatient(editingPatientId, apiPayload);
        setToast("Updated successfully.");
        await refreshToday();
      }
      closeEditModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function onResetClick() {
    resetForm();
    scrollToTop();
  }

  async function onRefreshClick() {
    await refreshToday();
    scrollToTop();
  }

  async function removePatient(row: Patient) {
    setDeletingPatientId(row.id);
    setError(null);
    try {
      await deletePatient(row.id);
      if (editingPatientId === row.id) resetForm();
      setToast("Patient deleted.");
      setDeleteConfirmPatient(null);
      await refreshToday();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete patient.");
    } finally {
      setDeletingPatientId(null);
    }
  }

  async function removeAllVisibleCases() {
    if (!canManageDoctorUsers) return;
    setDeletingAllCases(true);
    setError(null);
    try {
      const ids = rows.map((r) => r.id);
      for (const id of ids) {
        await deletePatient(id);
      }
      setDeleteAllConfirmOpen(false);
      setDeleteConfirmPatient(null);
      setToast("All visible cases deleted.");
      await refreshToday();
      await applyTableFilters();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete all cases.");
    } finally {
      setDeletingAllCases(false);
    }
  }

  async function onExport() {
    setExporting(true);
    try {
      const date = todayYmd();
      const data = await listPatients({ date });
      const sheetRows = data.map((r, idx) => {
        const parsed = parseDoctorNotes(r.notes);
        const dt = new Date(r.created_at);
        const time = isNaN(dt.getTime()) ? "-" : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
        const createdDate = isNaN(dt.getTime())
          ? "-"
          : `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
        const category = parsed.cat || (r.room === "room2" ? "Medical" : "Surgical");
        return {
          serial: idx + 1,
          patientId: r.id_no,
          gender: r.sex === "M" ? "Male" : "Female",
          age: r.age,
          diagnosisNumbers: parsed.dxNo.join(", ") || "-",
          diagnosisNames: parsed.dx.join(", ") || "-",
          category,
          ww: r.ww ? "Yes" : "No",
          disposition: parsed.disposition || "-",
          time,
          createdDate,
          createdBy: (r.created_by ?? "").trim() || "-",
        };
      });
      await exportStyledExcel({
        sheetName: "Doctor Daily",
        title: "Doctor OPD Daily Export",
        subtitle: `Date: ${date}`,
        filename: `doctor-opd-${date}.xlsx`,
        columns: [
          { header: "#", key: "serial", width: 8 },
          { header: "Patient ID", key: "patientId", width: 18 },
          { header: "Gender", key: "gender", width: 12 },
          { header: "Age", key: "age", width: 10 },
          { header: "Diagnosis No", key: "diagnosisNumbers", width: 20 },
          { header: "Diagnosis Name", key: "diagnosisNames", width: 40 },
          { header: "Category", key: "category", width: 14 },
          { header: "WW", key: "ww", width: 10 },
          { header: "Disposition", key: "disposition", width: 18 },
          { header: "Time", key: "time", width: 12 },
          { header: "Created Date", key: "createdDate", width: 16 },
          { header: "Created By", key: "createdBy", width: 20 },
        ],
        rows: sheetRows,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function generateSummaryReport() {
    setSummaryLoading(true);
    setError(null);
    try {
      if (summaryMode === "date") {
        const date = summaryDate.trim();
        if (!date) throw new Error("Please select a date.");
        const data = await listPatients({ date });
        setSummaryRows(data);
        setSummaryLabel(date);
        return;
      }
      const from = summaryFrom.trim();
      const to = summaryTo.trim();
      if (!from || !to) throw new Error("Please select both from and to dates.");
      const data = await listPatients({ from_date: from, to_date: to });
      setSummaryRows(data);
      setSummaryLabel(`${from} to ${to}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  }

  function exportSummaryExcel() {
    const safeLabel = summaryLabel.replace(/[^\w\-]+/g, "_");
    void exportStyledExcel({
      sheetName: "Summary",
      title: "Doctor Summary Report",
      subtitle: `Range: ${summaryLabel}`,
      filename: `doctor-summary-${safeLabel}.xlsx`,
      columns: [
        { header: "Total", key: "total", width: 12 },
        { header: "Male", key: "male", width: 12 },
        { header: "Female", key: "female", width: 12 },
        { header: "Surgical WW", key: "wwCount", width: 16 },
        { header: "Surgical Non-WW", key: "nonWw", width: 18 },
        { header: "Age Breakdown", key: "ageBreakdown", width: 42 },
        { header: "Top Diagnoses", key: "topDx", width: 48 },
      ],
      rows: [
        {
          total: stats.total,
          male: stats.male,
          female: stats.female,
          wwCount: stats.wwCount,
          nonWw: stats.nonWw,
          ageBreakdown: stats.ageBreakdown
            .map((g) => `${g.label}: M ${g.male} / F ${g.female}`)
            .join(" | "),
          topDx: stats.topDx.length === 0 ? "No data" : stats.topDx.map(([dx, c]) => `${dx} (${c})`).join(" | "),
        },
      ],
    });
  }

  const creatorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const u = (r.created_by ?? "").trim();
      if (u) set.add(u);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  function exportFilteredTableExcel() {
    const { from, to } = currentTableRange();
    const exportRows = rows.map((r, idx) => {
      const parsed = parseDoctorNotes(r.notes);
      const dt = new Date(r.created_at);
      const time = isNaN(dt.getTime()) ? "-" : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
      const createdDate = isNaN(dt.getTime())
        ? "-"
        : `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
      const category = parsed.cat || (r.room === "room2" ? "Medical" : "Surgical");
      return {
        serial: idx + 1,
        patientId: r.id_no,
        gender: r.sex === "M" ? "Male" : "Female",
        age: r.age,
        diagnosisNumbers: parsed.dxNo.join(", ") || "-",
        diagnosisNames: parsed.dx.join(", ") || "-",
        category,
        ww: r.ww ? "Yes" : "No",
        disposition: parsed.disposition || "-",
        time,
        createdDate,
        createdBy: (r.created_by ?? "").trim() || "-",
      };
    });
    void exportStyledExcel({
      sheetName: "Doctor Table",
      title: "Doctor Patients Table",
      subtitle: `Range: ${from} to ${to} | Total: ${rows.length}`,
      filename: `doctor-table-${from}-to-${to}.xlsx`,
      columns: [
        { header: "#", key: "serial", width: 8 },
        { header: "Patient ID", key: "patientId", width: 18 },
        { header: "Gender", key: "gender", width: 12 },
        { header: "Age", key: "age", width: 10 },
        { header: "Diagnosis No", key: "diagnosisNumbers", width: 20 },
        { header: "Diagnosis Name", key: "diagnosisNames", width: 40 },
        { header: "Category", key: "category", width: 14 },
        { header: "WW", key: "ww", width: 10 },
        { header: "Disposition", key: "disposition", width: 18 },
        { header: "Time", key: "time", width: 12 },
        { header: "Created Date", key: "createdDate", width: 16 },
        ...(canManageDoctorUsers ? [{ header: "Created By", key: "createdBy", width: 20 }] : []),
      ],
      rows: exportRows,
    });
  }

  async function toggleRegisteredCasesTotal() {
    if (showRegisteredCasesTotal) {
      setShowRegisteredCasesTotal(false);
      await applyTableFilters();
      return;
    }
    setShowRegisteredCasesTotal(true);
    setRegisteredCasesLoading(true);
    try {
      const [total, allRows] = await Promise.all([getPatientsCount(), listPatients({})]);
      setRegisteredCasesTotal(total);
      setRows(allRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load total registered cases.");
    } finally {
      setRegisteredCasesLoading(false);
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
        <div className="mb-4">
          <div className="mb-2 flex justify-end">
            <PwaClient mode="header" />
          </div>
          <h1 className="text-xl font-semibold">OPD LoggerX</h1>
          <div className="mt-2 flex flex-wrap items-center justify-start gap-2">
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
            </div>
          </div>
        </div>

        <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setActiveSection("new")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === "new"
                ? "bg-slate-600 text-white"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("summary")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === "summary"
                ? "bg-slate-600 text-white"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            Today Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("tables")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              activeSection === "tables"
                ? "bg-slate-600 text-white"
                : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            Tables
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <form
            onSubmit={onSubmit}
            className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2 ${
              activeSection === "new" ? "" : "hidden"
            }`}
          >
            <div className="mb-3 text-sm font-semibold">New</div>
            {pendingCount > 0 ? (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={openPending}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm transition-colors hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100 dark:hover:bg-amber-900/30"
                  title="Pending offline doctor cases"
                >
                  Pending ({pendingCount})
                </button>
              </div>
            ) : null}
            {error ? <div className="mb-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">{error}</div> : null}
            {toast ? <div className="mb-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-100">{toast}</div> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Patient ID</label>
                <input
                  value={patientId}
                  onFocus={() => setKeypadTarget("patientId")}
                  onChange={(e) => setPatientId(e.target.value)}
                  className={`mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm dark:bg-zinc-950 ${
                    keypadTarget === "patientId"
                      ? "border-slate-500 dark:border-slate-500"
                      : "border-zinc-200 dark:border-zinc-800"
                  }`}
                />
                <div className="mt-2 grid grid-cols-3 gap-1">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "⌫"].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => applyKeypadInput(k)}
                      className="min-h-11 rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                    >
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Age Range</label>
                <div className="mt-1 grid grid-cols-4 gap-1">
                  {[
                    { id: "lt5", label: "<5" },
                    { id: "5to14", label: "5-14" },
                    { id: "15to17", label: "15-17" },
                    { id: "gte18", label: ">=18" },
                  ].map((opt) => {
                    const selected = ageRange === (opt.id as AgeRange);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setAgeRange(opt.id as AgeRange)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                          selected
                            ? "border-slate-600 bg-slate-600 text-white"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Gender</label>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:max-w-md">
                {[
                  { id: "M", label: "Male" },
                  { id: "F", label: "Female" },
                ].map((opt) => {
                  const selected = sex === (opt.id as Sex);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setSex(opt.id as Sex)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                        selected
                          ? "border-slate-600 bg-slate-600 text-white"
                          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Diagnosis (up to 2)</div>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {orderedDiagnoses.map((d, idx) => {
                  const selected = selectedDx.includes(d.no);
                  return (
                    <button
                      key={d.no}
                      type="button"
                      onClick={() => {
                        setSelectedDx((prev) => {
                          if (prev.includes(d.no)) {
                            if (d.no === 4) {
                              setInfectionChoice("");
                              setInfectionOtherText("");
                            }
                            return prev.filter((x) => x !== d.no);
                          }
                          if (prev.length >= 2) return [prev[1], d.no];
                          return [...prev, d.no];
                        });
                      }}
                      className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selected ? "border-slate-600 bg-slate-600 text-white" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
                    >
                      <div>{idx + 1}. {d.name}</div>
                      <div className={`mt-1 text-[10px] font-medium ${selected ? "text-slate-100/90" : "text-zinc-500 dark:text-zinc-400"}`}>
                        {d.category}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedDx.includes(4) ? (
              <div className="mt-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Infection Disease Type
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[
                    { id: "acute_viral_hepatitis", label: "Acute Viral Hepatitis" },
                    { id: "mumps", label: "Mumps" },
                    { id: "chicken_pox", label: "Chicken pox" },
                    { id: "measles", label: "Measles" },
                    { id: "menningits", label: "Menningits" },
                    { id: "other", label: "Other" },
                  ].map((opt) => {
                    const selected = infectionChoice === (opt.id as InfectionChoice);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setInfectionChoice(opt.id as InfectionChoice)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                          selected
                            ? "border-slate-600 bg-slate-600 text-white"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                {infectionChoice === "other" ? (
                  <input
                    value={infectionOtherText}
                    onChange={(e) => setInfectionOtherText(e.target.value)}
                    placeholder="Write rare infection disease..."
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                ) : null}
              </div>
            ) : null}

            <div className="mt-3">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Disposition</label>
              <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
                {[
                  { id: "discharged", label: "Discharged" },
                  { id: "admitted", label: "Admitted" },
                  { id: "referred_ed", label: "Referred to ED" },
                  { id: "referred_out", label: "Referred out" },
                ].map((opt) => {
                  const selected = disposition === (opt.id as Disposition);
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setDisposition(opt.id as Disposition)}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                        selected
                          ? "border-slate-600 bg-slate-600 text-white"
                          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {hasSelectedSurgical ? (
                <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <span>WW</span>
                  <input type="checkbox" checked={ww} onChange={(e) => setWw(e.target.checked)} />
                </label>
              ) : (
                <div />
              )}
              <div />
            </div>

            <div className="mt-3 flex gap-2">
              <button disabled={saving} type="submit" className="cursor-pointer rounded-xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
                {saving ? "Saving..." : editingPatientId ? "Update" : "Save & New"}
              </button>
              {editingPatientId ? (
                <button
                  type="button"
                  onClick={onResetClick}
                  className="cursor-pointer rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900"
                >
                  Cancel Edit
                </button>
              ) : null}
              <button type="button" onClick={onResetClick} className="cursor-pointer rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                Reset
              </button>
              <button type="button" onClick={() => void onRefreshClick()} className="cursor-pointer rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900">
                Refresh
              </button>
            </div>
          </form>

          <div
            className={`rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
              activeSection === "summary" ? "" : "hidden"
            }`}
            id="doctor-summary-card"
          >
            <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Summary Range</div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSummaryMode("date")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      summaryMode === "date"
                        ? "bg-violet-600 text-white"
                        : "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200"
                    }`}
                  >
                    Specific day
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryMode("range")}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      summaryMode === "range"
                        ? "bg-violet-600 text-white"
                        : "border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200"
                    }`}
                  >
                    Date range
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {summaryMode === "date" ? (
                    <DatePickerField label="Date" value={summaryDate} onChange={setSummaryDate} title="Summary date" />
                  ) : (
                    <>
                      <DatePickerField label="From" value={summaryFrom} onChange={setSummaryFrom} title="Summary from date" />
                      <DatePickerField label="To" value={summaryTo} onChange={setSummaryTo} title="Summary to date" />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const today = todayYmd();
                      setSummaryMode("date");
                      setSummaryDate(today);
                      setSummaryFrom(today);
                      setSummaryTo(today);
                    }}
                    className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-900 dark:border-cyan-900/40 dark:bg-cyan-900/20 dark:text-cyan-100"
                  >
                    Clear filter
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSummaryExporting(true);
                      try {
                        exportSummaryExcel();
                      } finally {
                        setSummaryExporting(false);
                      }
                    }}
                    disabled={summaryExporting}
                    className="rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-900 dark:border-cyan-900/40 dark:bg-cyan-900/20 dark:text-cyan-100 disabled:opacity-60"
                  >
                    {summaryExporting ? "Exporting..." : "Export Summary Excel"}
                  </button>
                </div>
              </div>
              <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Showing: {summaryLabel}</div>
            </div>

            <div>
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                <div className="min-w-0 rounded-xl border border-zinc-200 p-2 sm:p-3 dark:border-zinc-800">
                <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:text-xs">Total</div>
                <div className="text-lg font-extrabold sm:text-2xl">{stats.total}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-zinc-200 p-2 sm:p-3 dark:border-zinc-800">
                <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:text-xs">Male</div>
                <div className="text-lg font-extrabold sm:text-2xl">{stats.male}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-zinc-200 p-2 sm:p-3 dark:border-zinc-800">
                <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:text-xs">Female</div>
                <div className="text-lg font-extrabold sm:text-2xl">{stats.female}</div>
                </div>
                <div className="min-w-0 rounded-xl border border-zinc-200 p-2 sm:p-3 dark:border-zinc-800">
                <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:text-xs">WW/Non</div>
                <div className="text-lg font-extrabold sm:text-2xl">
                  {stats.wwCount}/{stats.nonWw}
                </div>
              </div>
              </div>
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

            <div className="mt-4 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Top Diagnoses</div>
            <div className="mt-1 space-y-1 text-sm">
              {stats.topDx.length === 0 ? (
                <div className="text-zinc-500">No data yet</div>
              ) : (
                stats.topDx.map(([dx, c]) => <div key={dx}>{dx}: {c}</div>)
              )}
            </div>
          </div>
        </div>

        {editModalOpen && (editingPatientId || editingPendingId) ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Edit patient">
            <button type="button" className="absolute inset-0 bg-black/40" onClick={closeEditModal} aria-label="Close" />
            <div className="relative my-4 w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0 sm:max-h-[85vh] sm:overflow-y-auto">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold">{editingPendingId ? "Edit Pending Case" : "Edit Patient"}</div>
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Close
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Patient ID</label>
                  <input
                    value={patientId}
                    onChange={(e) => setPatientId(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Age Range</label>
                  <div className="mt-1 grid grid-cols-4 gap-1">
                    {[
                      { id: "lt5", label: "<5" },
                      { id: "5to14", label: "5-14" },
                      { id: "15to17", label: "15-17" },
                      { id: "gte18", label: ">=18" },
                    ].map((opt) => {
                      const selected = ageRange === (opt.id as AgeRange);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setAgeRange(opt.id as AgeRange)}
                          className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                            selected
                              ? "border-slate-600 bg-slate-600 text-white"
                              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Gender</label>
                <div className="mt-1 grid grid-cols-2 gap-1 sm:max-w-md">
                  {[
                    { id: "M", label: "Male" },
                    { id: "F", label: "Female" },
                  ].map((opt) => {
                    const selected = sex === (opt.id as Sex);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setSex(opt.id as Sex)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                          selected
                            ? "border-slate-600 bg-slate-600 text-white"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Diagnosis (up to 2)</div>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {orderedDiagnoses.map((d, idx) => {
                    const selected = selectedDx.includes(d.no);
                    return (
                      <button
                        key={d.no}
                        type="button"
                        onClick={() => {
                          setSelectedDx((prev) => {
                            if (prev.includes(d.no)) {
                              if (d.no === 4) {
                                setInfectionChoice("");
                                setInfectionOtherText("");
                              }
                              return prev.filter((x) => x !== d.no);
                            }
                            if (prev.length >= 2) return [prev[1], d.no];
                            return [...prev, d.no];
                          });
                        }}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold ${selected ? "border-slate-600 bg-slate-600 text-white" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"}`}
                      >
                        <div>{idx + 1}. {d.name}</div>
                        <div className={`mt-1 text-[10px] font-medium ${selected ? "text-slate-100/90" : "text-zinc-500 dark:text-zinc-400"}`}>
                          {d.category}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedDx.includes(4) ? (
                <div className="mt-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Infection Disease Type
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                      { id: "acute_viral_hepatitis", label: "Acute Viral Hepatitis" },
                      { id: "mumps", label: "Mumps" },
                      { id: "chicken_pox", label: "Chicken pox" },
                      { id: "measles", label: "Measles" },
                      { id: "menningits", label: "Menningits" },
                      { id: "other", label: "Other" },
                    ].map((opt) => {
                      const selected = infectionChoice === (opt.id as InfectionChoice);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setInfectionChoice(opt.id as InfectionChoice)}
                          className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                            selected
                              ? "border-slate-600 bg-slate-600 text-white"
                              : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {infectionChoice === "other" ? (
                    <input
                      value={infectionOtherText}
                      onChange={(e) => setInfectionOtherText(e.target.value)}
                      placeholder="Write rare infection disease..."
                      className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Disposition</div>
                <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
                  {[
                    { id: "discharged", label: "Discharged" },
                    { id: "admitted", label: "Admitted" },
                    { id: "referred_ed", label: "Referred to ED" },
                    { id: "referred_out", label: "Referred out" },
                  ].map((opt) => {
                    const selected = disposition === (opt.id as Disposition);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setDisposition(opt.id as Disposition)}
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold ${
                          selected
                            ? "border-slate-600 bg-slate-600 text-white"
                            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {hasSelectedSurgical ? (
                <label className="mt-3 flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <span>WW</span>
                  <input type="checkbox" checked={ww} onChange={(e) => setWw(e.target.checked)} />
                </label>
              ) : null}

              {error ? <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-100">{error}</div> : null}

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeEditModal}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEditFromModal()}
                  disabled={saving}
                  className="rounded-xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteConfirmPatient ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Delete patient confirmation">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setDeleteConfirmPatient(null)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0">
              <div className="text-sm font-semibold">Delete patient</div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                Are you sure you want to delete patient <span className="font-semibold">{deleteConfirmPatient.id_no}</span>?
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmPatient(null)}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingPatientId === deleteConfirmPatient.id}
                  onClick={() => void removePatient(deleteConfirmPatient)}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 disabled:opacity-60"
                >
                  {deletingPatientId === deleteConfirmPatient.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {deleteAllConfirmOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Delete all cases confirmation">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setDeleteAllConfirmOpen(false)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0">
              <div className="text-sm font-semibold">Delete all cases</div>
              <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                This will delete all currently listed cases ({rows.length}). Are you sure?
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteAllConfirmOpen(false)}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold dark:border-zinc-800 dark:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingAllCases || rows.length === 0}
                  onClick={() => void removeAllVisibleCases()}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 disabled:opacity-60"
                >
                  {deletingAllCases ? "Deleting..." : "Delete all"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

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

        {pendingOpen ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Pending offline doctor patients">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              onClick={() => setPendingOpen(false)}
              aria-label="Close"
            />
            <div className="relative my-4 w-full max-w-4xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Pending offline patients ({pendingItems.length})</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      writeDoctorPending([]);
                      setPendingItems([]);
                      setPendingCount(0);
                    }}
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
                  >
                    Clear all
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await flushPendingCreates();
                      setPendingItems(readDoctorPending());
                    }}
                    className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Sync now
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingOpen(false)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    Close
                  </button>
                </div>
              </div>
              {pendingItems.length === 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
                  No pending patients.
                </div>
              ) : (
                <div className="overflow-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <table className="w-full border-separate border-spacing-0 text-xs">
                    <thead>
                      <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">#</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Patient ID</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Gender</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Age</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Created At</th>
                        <th className="sticky top-0 bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/70">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingItems.map((it, idx) => (
                        <tr key={it.id} className="border-t border-zinc-200 dark:border-zinc-800">
                          <td className="px-3 py-2">{idx + 1}</td>
                          <td className="px-3 py-2">{it.payload.id_no}</td>
                          <td className="px-3 py-2">{it.payload.sex === "M" ? "Male" : "Female"}</td>
                          <td className="px-3 py-2">{it.payload.ageRange}</td>
                          <td className="px-3 py-2">{new Date(it.created_at).toLocaleString()}</td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                              onClick={() => {
                                setEditingPatientId(null);
                                setEditingPendingId(it.id);
                                setPatientId(it.payload.id_no);
                                setSex(it.payload.sex);
                                setAgeRange(it.payload.ageRange);
                                setSelectedDx(it.payload.selectedDx);
                                setInfectionChoice(it.payload.infectionChoice);
                                setInfectionOtherText(it.payload.infectionOtherText);
                                setWw(it.payload.ww);
                                setDisposition(it.payload.disposition);
                                setPendingOpen(false);
                                setEditModalOpen(true);
                              }}
                                className="rounded-md border border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-900"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const next = readDoctorPending().filter((x) => x.id !== it.id);
                                  writeDoctorPending(next);
                                  setPendingItems(next);
                                  setPendingCount(next.length);
                                }}
                                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200"
                              >
                                Delete
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

        <div
          className={`mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${
            activeSection === "tables" ? "" : "hidden"
          }`}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">All Data / Export</div>
            <div className="flex gap-2">
              {canManageDoctorUsers ? (
                <button
                  type="button"
                  onClick={() => setDeleteAllConfirmOpen(true)}
                  disabled={deletingAllCases || rows.length === 0}
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 disabled:opacity-60"
                >
                  {deletingAllCases ? "Deleting..." : "Delete all cases"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setTableExporting(true);
                  try {
                    exportFilteredTableExcel();
                  } finally {
                    setTableExporting(false);
                  }
                }}
                disabled={tableExporting}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-900 disabled:opacity-60"
              >
                {tableExporting ? "Exporting..." : "Export Filtered Excel"}
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => void onExport()}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-900"
              >
                {exporting ? "Exporting..." : "Export Excel"}
              </button>
            </div>
          </div>
          <div className="mb-3 overflow-hidden rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="mb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-300">Table Filters</div>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTableMode("daily")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tableMode === "daily"
                      ? "bg-emerald-600 text-white"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
                  }`}
                >
                  daily
                </button>
                <button
                  type="button"
                  onClick={() => setTableMode("weekly")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tableMode === "weekly"
                      ? "bg-emerald-600 text-white"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
                  }`}
                >
                  weekly
                </button>
                <button
                  type="button"
                  onClick={() => setTableMode("monthly")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tableMode === "monthly"
                      ? "bg-emerald-600 text-white"
                      : "border border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-200"
                  }`}
                >
                  monthly
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTableMode("range")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tableMode === "range"
                      ? "bg-fuchsia-600 text-white"
                      : "border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-900/20 dark:text-fuchsia-200"
                  }`}
                >
                  custom range
                </button>
                <button
                  type="button"
                  onClick={() => setTableMode("daily")}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    tableMode === "daily"
                      ? "bg-violet-600 text-white"
                      : "border border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/40 dark:bg-violet-900/20 dark:text-violet-200"
                  }`}
                >
                  Specific day
                </button>
                {tableMode === "range" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <DatePickerField label="From" value={tableFromDate} onChange={setTableFromDate} title="Table from date" />
                    <DatePickerField label="To" value={tableToDate} onChange={setTableToDate} title="Table to date" />
                  </div>
                ) : (
                  <DatePickerField label="Date" value={tableRefDate} onChange={setTableRefDate} title="Table date" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canManageDoctorUsers ? (
                  <select
                    value={tableCreator}
                    onChange={(e) => setTableCreator(e.target.value)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                  >
                    <option value="all">All doctor</option>
                    {creatorOptions.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                ) : (
                  <button
                    type="button"
                    onClick={() => setTableMineOnly((prev) => !prev)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      tableMineOnly
                        ? "bg-slate-600 text-white"
                        : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                    }`}
                  >
                    {tableMineOnly ? "My cases only" : "Show my cases"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTableMode("daily");
                    const today = todayYmd();
                    setTableRefDate(today);
                    setTableFromDate(today);
                    setTableToDate(today);
                    setTableCreator("all");
                    setTableMineOnly(false);
                  }}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-100"
                >
                  Clear filter
                </button>
                <button
                  type="button"
                  onClick={() => void toggleRegisteredCasesTotal()}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    showRegisteredCasesTotal
                      ? "bg-slate-600 text-white"
                      : "border border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                >
                  All cases
                </button>
              </div>
            </div>
            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-100">
              Total Patients: {rows.length}
            </div>
          </div>
          {loading || tableLoading ? (
            <div className="text-sm text-zinc-500">Loading...</div>
          ) : (
            <div className="overflow-auto doctor-cases-table">
              <table className="w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">#</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Patient ID</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Gender</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Age</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Dx No(s)</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Dx Name(s)</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Cat</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">WW</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Disposition</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Time</th>
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Created Date</th>
                    {canManageDoctorUsers ? <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Created By</th> : null}
                    <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {showRegisteredCasesTotal ? (
                    <tr className="border-t border-zinc-200 bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900/40">
                      <td colSpan={tableColSpan} className="px-3 py-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                        All registered cases (all days):{" "}
                        {registeredCasesLoading ? "Loading..." : (registeredCasesTotal ?? rows.length)}
                      </td>
                    </tr>
                  ) : null}
                  {rows.map((r, idx) => {
                    const parsed = parseDoctorNotes(r.notes);
                    const dt = new Date(r.created_at);
                    const time = isNaN(dt.getTime()) ? "-" : `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
                    const createdDate = isNaN(dt.getTime())
                      ? "-"
                      : `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
                    const category = parsed.cat || (r.room === "room2" ? "Medical" : "Surgical");
                    const rowCreatedBy = (r.created_by ?? "").trim().toLowerCase();
                    const currentUsername = (authUser?.username ?? "").trim().toLowerCase();
                    const canManageThisRow =
                      canManageDoctorUsers || (rowCreatedBy.length > 0 && rowCreatedBy === currentUsername);
                    return (
                      <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="px-3 py-2">{idx + 1}</td>
                        <td className="px-3 py-2">{r.id_no}</td>
                        <td className="px-3 py-2">{r.sex === "M" ? "Male" : "Female"}</td>
                        <td className="px-3 py-2">{r.age}</td>
                        <td className="px-3 py-2">{parsed.dxNo.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{parsed.dx.join(", ") || "-"}</td>
                        <td className="px-3 py-2">{category}</td>
                        <td className="px-3 py-2">{r.ww ? "Yes" : "No"}</td>
                        <td className="px-3 py-2">{parsed.disposition || "-"}</td>
                        <td className="px-3 py-2">{time}</td>
                        <td className="px-3 py-2">{createdDate}</td>
                        {canManageDoctorUsers ? <td className="px-3 py-2">{r.created_by && r.created_by.trim() ? r.created_by : "-"}</td> : null}
                        <td className="px-3 py-2">
                          {canManageThisRow ? (
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => startEditPatient(r)}
                                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold dark:border-zinc-800 dark:bg-zinc-900"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={deletingPatientId === r.id}
                                onClick={() => setDeleteConfirmPatient(r)}
                                className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-800 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-200 disabled:opacity-60"
                              >
                                {deletingPatientId === r.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          ) : (
                            <span className="text-zinc-400">-</span>
                          )}
                        </td>
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
