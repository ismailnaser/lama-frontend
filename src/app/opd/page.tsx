"use client";

import { fetchCurrentUser, logout } from "@/lib/authApi";
import { getAuthToken, setAuthToken, type AuthUser } from "@/lib/auth";
import { Ban, Download, LogOut, Moon, Pencil, Plus, Shield, Sun, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createUser, deleteUser, listUsers, type AdminUserRow, updateUser } from "@/lib/usersApi";
import { PwaClient } from "@/components/PwaClient";

type OpdEntry = {
  id: string;
  time: string;
  createdAt: string;
  patientId: string;
  gender: "Male" | "Female";
  ageGroup: "<5" | "5-14" | "15-17" | "18+";
  diagnoses: string[];
  warWounded: boolean;
  disposition: string;
  createdByUsername: string;
};

const OPD_DATA_KEY = "opd_loggerx_entries";
const OPD_PENDING_KEY = "opd_loggerx_pending_entries";
const OPD_DEMO_SEEDED_KEY = "opd_loggerx_demo_seeded_once";
const DIAGNOSES: { id: number; name: string; category: "Medical" | "Surgical" }[] = [
  { id: 1, name: "Respiratory Tract Infection", category: "Medical" },
  { id: 2, name: "Acute Watery Diarrhea", category: "Medical" },
  { id: 3, name: "Acute Bloody Diarrhea", category: "Medical" },
  { id: 4, name: "Infectious disease", category: "Medical" },
  { id: 5, name: "Other GI Diseases", category: "Medical" },
  { id: 6, name: "Scabies", category: "Medical" },
  { id: 7, name: "Skin Infection", category: "Medical" },
  { id: 8, name: "Other Skin Diseases", category: "Medical" },
  { id: 9, name: "Genitourinary Diseases", category: "Medical" },
  { id: 10, name: "Musculoskeletal Diseases", category: "Medical" },
  { id: 11, name: "Hypertension", category: "Medical" },
  { id: 12, name: "Diabetes", category: "Medical" },
  { id: 13, name: "Epilepsy", category: "Medical" },
  { id: 14, name: "Eye Diseases", category: "Medical" },
  { id: 15, name: "ENT Diseases", category: "Medical" },
  { id: 16, name: "Other Medical Diseases", category: "Medical" },
  { id: 17, name: "Fracture", category: "Surgical" },
  { id: 18, name: "Burn", category: "Surgical" },
  { id: 19, name: "Gunshot Wound (GSW)", category: "Surgical" },
  { id: 20, name: "Other Wound", category: "Surgical" },
  { id: 21, name: "Other Surgical", category: "Surgical" },
  { id: 22, name: "Dental", category: "Medical" },
];
const DISPOSITIONS = ["Discharged", "Admitted", "Referred to ED", "Referred out"];
const ID_KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "CLR", "0", "⌫"] as const;
const AGE_GROUPS = ["<5", "5-14", "15-17", "18+"] as const;
const INFECTIOUS_DISEASE_LABEL = "Infectious disease";
const INFECTIOUS_OTHER_LABEL = "Other";
const INFECTIOUS_OPTIONS = [
  "Acute Viral Hepatitis",
  "Mumps",
  "Chicken pox",
  "Measles",
  "Meningitis",
  INFECTIOUS_OTHER_LABEL,
] as const;

function readOpdEntries(): OpdEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OPD_DATA_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpdEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => ({
      ...row,
      ageGroup: normalizeAgeGroup(row.ageGroup),
      createdAt: row.createdAt ?? new Date().toISOString(),
      createdByUsername: row.createdByUsername ?? "unknown",
    }));
  } catch {
    return [];
  }
}

function normalizeAgeGroup(value: unknown): (typeof AGE_GROUPS)[number] {
  const raw = String(value ?? "").trim();
  if (raw === "<5" || raw === "5-14" || raw === "15-17" || raw === "18+") return raw;
  // Keep compatibility with old values that used >= / ≥ formatting.
  if (raw === "≥18" || raw === ">=18" || raw === ">18") return "18+";
  return "<5";
}

function writeOpdEntries(items: OpdEntry[]) {
  localStorage.setItem(OPD_DATA_KEY, JSON.stringify(items));
}

function readPendingOpdEntries(): OpdEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(OPD_PENDING_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OpdEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingOpdEntries(items: OpdEntry[]) {
  localStorage.setItem(OPD_PENDING_KEY, JSON.stringify(items));
}

function formatDate(isoLike: string) {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString();
}

function isoDayKey(isoLike: string) {
  const d = new Date(isoLike);
  if (Number.isNaN(d.getTime())) return "";
  return ymd(d);
}

function ymd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayYmd() {
  return ymd(new Date());
}

function startOfWeekYmd() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun ... 6=Sat
  const diff = (day + 1) % 7; // Saturday-based week start
  d.setDate(d.getDate() - diff);
  return ymd(d);
}

function startOfMonthYmd() {
  const d = new Date();
  d.setDate(1);
  return ymd(d);
}

function diagnosisNumbersText(diagnoses: string[]) {
  const nums = diagnoses
    .map((name) =>
      name.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
        ? 4
        : DIAGNOSES.find((dx) => dx.name === name)?.id
    )
    .filter((n): n is number => typeof n === "number");
  return nums.length ? nums.join("+") : "-";
}

function entryCategoryText(diagnoses: string[]) {
  const hasSurgical = diagnoses.some((name) => {
    const dx = DIAGNOSES.find((item) => item.name === name);
    return dx?.category === "Surgical";
  });
  if (hasSurgical) return "S";
  return "M";
}

function hasInfectiousDiagnosis(values: string[]) {
  return values.some(
    (d) => d === INFECTIOUS_DISEASE_LABEL || d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
  );
}

function isDiagnosisSelected(values: string[], diagnosisName: string) {
  if (diagnosisName !== INFECTIOUS_DISEASE_LABEL) return values.includes(diagnosisName);
  return hasInfectiousDiagnosis(values);
}

function buildOpdDemoEntries(username: string): OpdEntry[] {
  const dispositions = ["Discharged", "Admitted", "Referred to ED", "Referred out"] as const;
  const ageGroups = ["<5", "5-14", "15-17", "18+"] as const;
  const baseDx = [
    "Respiratory Tract Infection",
    "Acute Bloody Diarrhea",
    "Hypertension",
    "Dental",
    "Fracture",
    "Burn",
    "Other Surgical",
  ];

  const now = new Date();
  const entries: OpdEntry[] = [];
  let seq = 1;
  for (const offset of [0, 1, 2, 3, 5, 7, 10, 14, 18, 23, 30, 37]) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    const perDay = offset % 2 === 0 ? 3 : 2;
    for (let i = 0; i < perDay; i++) {
      const dx1 = baseDx[(offset + i) % baseDx.length];
      const dx2 = baseDx[(offset + i + 2) % baseDx.length];
      const withTwo = (offset + i) % 3 !== 0;
      const createdAt = new Date(day);
      createdAt.setHours(8 + ((offset + i) % 8), (offset * 7 + i * 11) % 60, 0, 0);
      const diag = withTwo ? [dx1, dx2] : [dx1];
      entries.push({
        id: `demo-${createdAt.getTime()}-${seq}`,
        time: createdAt.toLocaleTimeString(),
        createdAt: createdAt.toISOString(),
        patientId: String(7000 + seq),
        gender: (seq + i) % 2 === 0 ? "Female" : "Male",
        ageGroup: ageGroups[(seq + i) % ageGroups.length],
        diagnoses: diag,
        warWounded: diag.some((d) => ["Fracture", "Burn", "Other Surgical"].includes(d)) ? (seq % 2 === 0) : false,
        disposition: dispositions[(seq + i) % dispositions.length],
        createdByUsername: username || "opdadmin",
      });
      seq++;
    }
  }
  return entries;
}

export default function OpdPage() {
  const PAGE_SIZE = 10;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [entries, setEntries] = useState<OpdEntry[]>([]);
  const [patientId, setPatientId] = useState("");
  const [gender, setGender] = useState<"Male" | "Female">("Male");
  const [ageGroup, setAgeGroup] = useState<(typeof AGE_GROUPS)[number] | "">("");
  const [diagnoses, setDiagnoses] = useState<string[]>([]);
  const [infectiousChoice, setInfectiousChoice] = useState<(typeof INFECTIOUS_OPTIONS)[number] | "">("");
  const [infectiousOtherText, setInfectiousOtherText] = useState("");
  const [warWounded, setWarWounded] = useState(false);
  const [disposition, setDisposition] = useState(DISPOSITIONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserRow[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [createUserForm, setCreateUserForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "user" as "user" | "admin",
  });
  const [userEditing, setUserEditing] = useState<null | AdminUserRow>(null);
  const [userEditForm, setUserEditForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "user" as "user" | "admin",
    is_active: true,
  });
  const [userEditSaving, setUserEditSaving] = useState(false);
  const [userDelete, setUserDelete] = useState<null | AdminUserRow>(null);
  const [userDeleteSaving, setUserDeleteSaving] = useState(false);
  const [editingEntry, setEditingEntry] = useState<null | OpdEntry>(null);
  const [editForm, setEditForm] = useState({
    patientId: "",
    gender: "Male" as "Male" | "Female",
    ageGroup: "" as (typeof AGE_GROUPS)[number] | "",
    diagnoses: [] as string[],
    warWounded: false,
    disposition: DISPOSITIONS[0],
  });
  const [editInfectiousChoice, setEditInfectiousChoice] = useState<
    (typeof INFECTIOUS_OPTIONS)[number] | ""
  >("");
  const [editInfectiousOtherText, setEditInfectiousOtherText] = useState("");
  const [deleteEntry, setDeleteEntry] = useState<null | OpdEntry>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [patientIdFilter, setPatientIdFilter] = useState("");
  const [quickRange, setQuickRange] = useState<"daily" | "weekly" | "monthly" | "custom" | "">("");
  const [currentPage, setCurrentPage] = useState(1);
  const [toast, setToast] = useState<null | { kind: "success" | "error"; message: string }>(null);
  const lastFilterToastKeyRef = useRef("");

  const currentView = (searchParams.get("view") ?? "new") as "new" | "summary" | "data";

  function showToast(kind: "success" | "error", message: string) {
    setToast({ kind, message });
    if (typeof window !== "undefined") {
      window.setTimeout(() => setToast((prev) => (prev?.message === message ? null : prev)), 2200);
    }
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
        const user = await fetchCurrentUser();
        if (cancelled) return;
        if (user.app_type !== "opd") {
          router.replace("/");
          return;
        }
        setAuthUser(user);
        const loaded = readOpdEntries();
        if (loaded.length === 0 && localStorage.getItem(OPD_DEMO_SEEDED_KEY) !== "1") {
          const demo = buildOpdDemoEntries(user.username ?? "opdadmin");
          writeOpdEntries(demo);
          localStorage.setItem(OPD_DEMO_SEEDED_KEY, "1");
          setEntries(demo);
          showToast("success", "Demo OPD data seeded.");
        } else {
          setEntries(loaded);
        }
        setPendingCount(readPendingOpdEntries().length);
      } catch {
        setAuthToken(null);
        if (!cancelled) router.replace("/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filteredEntries = useMemo(() => {
    const from = fromDate.trim();
    const to = toDate.trim();
    const doctor = authUser?.role === "admin" ? doctorFilter.trim().toLowerCase() : "";
    const idNo = patientIdFilter.trim();
    const range = from || to;
    return entries.filter((row) => {
      const dateIso = row.createdAt ? row.createdAt.slice(0, 10) : "";
      if (range) {
        if (from && dateIso < from) return false;
        if (to && dateIso > to) return false;
      }
      if (doctor && (row.createdByUsername ?? "").toLowerCase() !== doctor) return false;
      if (idNo && !row.patientId.includes(idNo)) return false;
      return true;
    });
  }, [entries, fromDate, toDate, doctorFilter, patientIdFilter, authUser?.role]);

  useEffect(() => {
    if (authUser?.role === "admin") return;
    if (!doctorFilter) return;
    setDoctorFilter("");
  }, [authUser?.role, doctorFilter]);

  useEffect(() => {
    const key = `${fromDate}|${toDate}|${doctorFilter}|${patientIdFilter}`;
    if (key === lastFilterToastKeyRef.current) return;
    lastFilterToastKeyRef.current = key;
    if (!key.replace(/\|/g, "").trim()) return;
    showToast("success", "Filters applied.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, doctorFilter, patientIdFilter]);

  const doctorOptions = useMemo(() => {
    return [...new Set(entries.map((x) => (x.createdByUsername ?? "unknown").trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );
  }, [entries]);

  const hasActiveFilters = useMemo(() => {
    return Boolean(fromDate || toDate || doctorFilter || patientIdFilter);
  }, [fromDate, toDate, doctorFilter, patientIdFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedEntries = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredEntries.slice(start, start + PAGE_SIZE);
  }, [filteredEntries, safePage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [fromDate, toDate, doctorFilter, patientIdFilter]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const counts = useMemo(() => {
    let male = 0;
    let female = 0;
    for (const row of filteredEntries) {
      if (row.gender === "Male") male += 1;
      else female += 1;
    }
    return { total: filteredEntries.length, male, female };
  }, [filteredEntries]);

  const stats = useMemo(() => {
    const ageBreakdown: Record<(typeof AGE_GROUPS)[number], number> = {
      "<5": 0,
      "5-14": 0,
      "15-17": 0,
      "18+": 0,
    };
    const ageByGender: Record<(typeof AGE_GROUPS)[number], { Male: number; Female: number }> = {
      "<5": { Male: 0, Female: 0 },
      "5-14": { Male: 0, Female: 0 },
      "15-17": { Male: 0, Female: 0 },
      "18+": { Male: 0, Female: 0 },
    };
    const diagnosisCount = new Map<string, number>();
    let surgicalWw = 0;
    let surgicalNonWw = 0;

    for (const row of filteredEntries) {
      ageBreakdown[row.ageGroup] += 1;
      ageByGender[row.ageGroup][row.gender] += 1;

      const hasSurgicalDx = row.diagnoses.some((name) => {
        const dx = DIAGNOSES.find((item) => item.name === name);
        return dx?.id !== undefined && dx.id >= 17 && dx.id <= 21;
      });
      if (hasSurgicalDx) {
        if (row.warWounded) surgicalWw += 1;
        else surgicalNonWw += 1;
      }

      for (const dxName of row.diagnoses) {
        diagnosisCount.set(dxName, (diagnosisCount.get(dxName) ?? 0) + 1);
      }
    }

    const topDiagnoses = [...diagnosisCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return { ageBreakdown, ageByGender, surgicalWw, surgicalNonWw, topDiagnoses };
  }, [filteredEntries]);

  const showWwField = useMemo(() => {
    const selectedIds = diagnoses
      .map((name) => DIAGNOSES.find((dx) => dx.name === name)?.id ?? 0)
      .filter((id) => id > 0);
    return selectedIds.some((id) => id >= 17 && id <= 21);
  }, [diagnoses]);

  useEffect(() => {
    if (!showWwField && warWounded) {
      setWarWounded(false);
    }
  }, [showWwField, warWounded]);

  function toggleDiagnosis(value: string) {
    setDiagnoses((prev) => {
      const isInfectious = value === INFECTIOUS_DISEASE_LABEL;
      const hasInfectious = hasInfectiousDiagnosis(prev);
      if (isInfectious && hasInfectious) {
        setInfectiousChoice("");
        setInfectiousOtherText("");
        return prev.filter(
          (d) => d !== INFECTIOUS_DISEASE_LABEL && !d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
        );
      }
      if (!isInfectious && prev.includes(value)) return prev.filter((d) => d !== value);

      if (isInfectious) {
        const withoutInfectious = prev.filter(
          (d) => d !== INFECTIOUS_DISEASE_LABEL && !d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
        );
        if (withoutInfectious.length >= 2) return [withoutInfectious[1], INFECTIOUS_DISEASE_LABEL];
        return [...withoutInfectious, INFECTIOUS_DISEASE_LABEL];
      }
      // Keep only the latest 2 choices: selecting a 3rd removes the oldest one.
      if (prev.length >= 2) return [prev[1], value];
      return [...prev, value];
    });
  }

  function toggleDiagnosisForEdit(value: string) {
    setEditForm((prev) => {
      const isInfectious = value === INFECTIOUS_DISEASE_LABEL;
      const hasInfectious = hasInfectiousDiagnosis(prev.diagnoses);
      if (isInfectious && hasInfectious) {
        setEditInfectiousChoice("");
        setEditInfectiousOtherText("");
        return {
          ...prev,
          diagnoses: prev.diagnoses.filter(
            (d) => d !== INFECTIOUS_DISEASE_LABEL && !d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
          ),
        };
      }
      if (!isInfectious && prev.diagnoses.includes(value)) {
        return { ...prev, diagnoses: prev.diagnoses.filter((d) => d !== value) };
      }
      if (isInfectious) {
        const withoutInfectious = prev.diagnoses.filter(
          (d) => d !== INFECTIOUS_DISEASE_LABEL && !d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`)
        );
        if (withoutInfectious.length >= 2) {
          return { ...prev, diagnoses: [withoutInfectious[1], INFECTIOUS_DISEASE_LABEL] };
        }
        return { ...prev, diagnoses: [...withoutInfectious, INFECTIOUS_DISEASE_LABEL] };
      }
      if (prev.diagnoses.length >= 2) {
        return { ...prev, diagnoses: [prev.diagnoses[1], value] };
      }
      return { ...prev, diagnoses: [...prev.diagnoses, value] };
    });
  }

  function onIdKeyTap(key: (typeof ID_KEYPAD_KEYS)[number]) {
    if (key === "CLR") {
      setPatientId("");
      return;
    }
    if (key === "⌫") {
      setPatientId((prev) => prev.slice(0, -1));
      return;
    }
    setPatientId((prev) => `${prev}${key}`);
  }

  function saveEntry() {
    setError(null);
    if (!patientId.trim()) return setError("Patient ID is required.");
    if (!ageGroup) return setError("Choose age range.");
    if (diagnoses.length === 0) return setError("Choose at least one diagnosis.");
    if (hasInfectiousDiagnosis(diagnoses) && !infectiousChoice) {
      return setError("Choose infectious disease type.");
    }
    if (infectiousChoice === INFECTIOUS_OTHER_LABEL && !infectiousOtherText.trim()) {
      return setError("Write the rare infectious disease.");
    }

    const infectiousFinal = infectiousChoice
      ? infectiousChoice === INFECTIOUS_OTHER_LABEL
        ? `${INFECTIOUS_DISEASE_LABEL}: ${INFECTIOUS_OTHER_LABEL} - ${infectiousOtherText.trim()}`
        : `${INFECTIOUS_DISEASE_LABEL}: ${infectiousChoice}`
      : "";

    const normalizedDiagnoses = diagnoses.map((d) =>
      d === INFECTIOUS_DISEASE_LABEL ? infectiousFinal : d
    );

    const createdAt = new Date().toISOString();
    const todayKey = isoDayKey(createdAt);
    const targetId = patientId.trim();
    const alreadyTodayInSaved = entries.some(
      (row) => row.patientId.trim() === targetId && isoDayKey(row.createdAt) === todayKey
    );
    const alreadyTodayInPending = readPendingOpdEntries().some(
      (row) => row.patientId.trim() === targetId && isoDayKey(row.createdAt) === todayKey
    );
    if (alreadyTodayInSaved || alreadyTodayInPending) {
      const msg = "This patient ID is already registered today.";
      setError(msg);
      showToast("error", msg);
      return;
    }

    const next: OpdEntry = {
      id: `${Date.now()}`,
      time: new Date().toLocaleTimeString(),
      createdAt,
      patientId: patientId.trim(),
      gender,
      ageGroup,
      diagnoses: normalizedDiagnoses,
      warWounded,
      disposition,
      createdByUsername: authUser?.username ?? "unknown",
    };

    if (typeof window !== "undefined" && !navigator.onLine) {
      const pending = [next, ...readPendingOpdEntries()];
      writePendingOpdEntries(pending);
      setPendingCount(pending.length);
      showToast("success", "Saved offline. Will sync when online.");
    } else {
      const updated = [next, ...entries];
      setEntries(updated);
      writeOpdEntries(updated);
      showToast("success", "Patient added successfully.");
    }
    setPatientId("");
    setGender("Male");
    setAgeGroup("");
    setDiagnoses([]);
    setInfectiousChoice("");
    setInfectiousOtherText("");
    setWarWounded(false);
    setDisposition(DISPOSITIONS[0]);
  }

  function flushPendingEntries() {
    if (typeof window === "undefined") return;
    if (!navigator.onLine) return;
    const pending = readPendingOpdEntries();
    if (pending.length === 0) return;
    const updated = [...pending, ...readOpdEntries()];
    writeOpdEntries(updated);
    writePendingOpdEntries([]);
    setEntries(updated);
    setPendingCount(0);
    showToast("success", "Pending records synced.");
  }

  function seedOpdDemoData() {
    const demo = buildOpdDemoEntries(authUser?.username ?? "opdadmin");
    const existing = readOpdEntries();
    const existingIds = new Set(existing.map((e) => e.id));
    const merged = [...existing, ...demo.filter((e) => !existingIds.has(e.id))];
    writeOpdEntries(merged);
    setEntries(merged);
    showToast("success", "OPD demo data added.");
  }

  function exportExcel() {
    const headers = [
      "No",
      "Date",
      "Time",
      "Patient ID",
      "Gender",
      "Age",
      "Category",
      "Dx No(s)",
      "Dx Name(s)",
      "WW",
      "Disposition",
      "Created By",
    ];

    const esc = (v: string) =>
      v
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const rowsHtml = filteredEntries
      .map((x, i) => {
        const ageText = `'${x.ageGroup}`;
        const cols = [
          String(i + 1),
          formatDate(x.createdAt),
          x.time,
          x.patientId,
          x.gender,
          ageText,
          entryCategoryText(x.diagnoses),
          diagnosisNumbersText(x.diagnoses),
          x.diagnoses.join(" / "),
          x.warWounded ? "Yes" : "No",
          x.disposition,
          x.createdByUsername ?? "unknown",
        ];
        const tds = cols
          .map((c, idx) => {
            const tdClass = [idx === 0 ? "col-no" : "", idx === 5 ? "col-age" : ""]
              .filter(Boolean)
              .join(" ");
            return `<td class="${tdClass}">${esc(String(c))}</td>`;
          })
          .join("");
        return `<tr>${tds}</tr>`;
      })
      .join("");

    const tableHtml = `
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Calibri, Arial, sans-serif; padding: 12px; }
      .title { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
      .meta { margin-bottom: 10px; color: #444; font-size: 12px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #C9CED6; padding: 6px 8px; font-size: 12px; vertical-align: middle; }
      th {
        background: #1f4e78;
        color: #ffffff;
        text-align: center;
        font-weight: 700;
      }
      tr:nth-child(even) td { background: #F8FAFC; }
      .col-no { text-align: center; font-weight: 700; width: 44px; }
      /* Prevent Excel from auto-converting age ranges like 5-14 to dates. */
      .col-age { mso-number-format: "\\@"; }
    </style>
  </head>
  <body>
    <div class="title">OPD LoggerX - Filtered Export</div>
    <div class="meta">Generated: ${esc(new Date().toLocaleString())} | Rows: ${filteredEntries.length}</div>
    <table>
      <thead>
        <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </body>
</html>`;

    const blob = new Blob(["\uFEFF", tableHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "opd-loggerx-filtered.xls";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("success", "Excel exported (filtered data).");
  }

  function beginEditEntry(row: OpdEntry) {
    const infectiousSaved = row.diagnoses.find((d) => d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`));
    setEditingEntry(row);
    setEditForm({
      patientId: row.patientId,
      gender: row.gender,
      ageGroup: row.ageGroup,
      diagnoses: row.diagnoses.map((d) =>
        d.startsWith(`${INFECTIOUS_DISEASE_LABEL}:`) ? INFECTIOUS_DISEASE_LABEL : d
      ),
      warWounded: row.warWounded,
      disposition: row.disposition,
    });
    if (infectiousSaved) {
      const content = infectiousSaved.replace(`${INFECTIOUS_DISEASE_LABEL}:`, "").trim();
      if (content.startsWith(`${INFECTIOUS_OTHER_LABEL} - `)) {
        setEditInfectiousChoice(INFECTIOUS_OTHER_LABEL);
        setEditInfectiousOtherText(content.replace(`${INFECTIOUS_OTHER_LABEL} - `, "").trim());
      } else if (
        INFECTIOUS_OPTIONS.includes(content as (typeof INFECTIOUS_OPTIONS)[number])
      ) {
        setEditInfectiousChoice(content as (typeof INFECTIOUS_OPTIONS)[number]);
        setEditInfectiousOtherText("");
      } else {
        setEditInfectiousChoice(INFECTIOUS_OTHER_LABEL);
        setEditInfectiousOtherText(content);
      }
    } else {
      setEditInfectiousChoice("");
      setEditInfectiousOtherText("");
    }
  }

  function saveEditedEntry() {
    if (!editingEntry) return;
    if (!editForm.patientId.trim()) return;
    if (!editForm.ageGroup) return;
    if (editForm.diagnoses.length === 0) return;
    if (hasInfectiousDiagnosis(editForm.diagnoses) && !editInfectiousChoice) return;
    if (editInfectiousChoice === INFECTIOUS_OTHER_LABEL && !editInfectiousOtherText.trim()) return;

    const infectiousFinal = editInfectiousChoice
      ? editInfectiousChoice === INFECTIOUS_OTHER_LABEL
        ? `${INFECTIOUS_DISEASE_LABEL}: ${INFECTIOUS_OTHER_LABEL} - ${editInfectiousOtherText.trim()}`
        : `${INFECTIOUS_DISEASE_LABEL}: ${editInfectiousChoice}`
      : "";
    const normalizedDiagnoses = editForm.diagnoses.map((d) =>
      d === INFECTIOUS_DISEASE_LABEL ? infectiousFinal : d
    );

    const editingDay = isoDayKey(editingEntry.createdAt);
    const targetId = editForm.patientId.trim();
    const duplicateSameDay = entries.some(
      (row) =>
        row.id !== editingEntry.id &&
        row.patientId.trim() === targetId &&
        isoDayKey(row.createdAt) === editingDay
    );
    if (duplicateSameDay) {
      const msg = "This patient ID is already registered on the same day.";
      setError(msg);
      showToast("error", msg);
      return;
    }

    const updated = entries.map((row) =>
      row.id === editingEntry.id
        ? {
            ...row,
            patientId: editForm.patientId.trim(),
            gender: editForm.gender,
            ageGroup: editForm.ageGroup,
            diagnoses: normalizedDiagnoses,
            warWounded: editForm.warWounded,
            disposition: editForm.disposition,
          }
        : row
    );
    setEntries(updated);
    writeOpdEntries(updated);
    setEditingEntry(null);
    showToast("success", "Patient updated successfully.");
  }

  function confirmDeleteEntry() {
    if (!deleteEntry) return;
    const updated = entries.filter((row) => row.id !== deleteEntry.id);
    setEntries(updated);
    writeOpdEntries(updated);
    setDeleteEntry(null);
    showToast("success", "Patient deleted successfully.");
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
      setAdminError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
      document.documentElement.classList.toggle("dark", stored === "dark");
      return;
    }
    document.documentElement.classList.toggle("dark", true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!authUser) return;
    flushPendingEntries();
    function onOnline() {
      flushPendingEntries();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  return (
    <div className="min-h-full flex-1 bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto min-h-screen w-full max-w-7xl px-4 py-6 sm:px-6">
        <PwaClient />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">OPD LoggerX</h1>
          {authUser ? (
            <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="font-semibold">{authUser.username}</span>
              {pendingCount > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/20 dark:text-amber-100">
                  Pending: {pendingCount}
                </span>
              ) : null}
              {authUser.role === "admin" ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-100">
                  <Shield className="h-3 w-3" /> admin
                </span>
              ) : null}
              {authUser.role === "admin" ? (
                <button
                  type="button"
                  onClick={() => void openAdmin()}
                  disabled={adminLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
                >
                  <Plus className="h-3.5 w-3.5" /> Users
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
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
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
              >
                <LogOut className="h-3.5 w-3.5" /> Logout
              </button>
            </div>
          ) : null}
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => router.push("/opd?view=new")}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              currentView === "new"
                ? "bg-slate-700 text-white"
                : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            New/Edit
          </button>
          <button
            type="button"
            onClick={() => router.push("/opd?view=summary")}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              currentView === "summary"
                ? "bg-slate-700 text-white"
                : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => router.push("/opd?view=data")}
            className={`rounded-xl px-3 py-2 text-sm font-semibold ${
              currentView === "data"
                ? "bg-slate-700 text-white"
                : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            }`}
          >
            All Data / Export
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {currentView === "new" ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-1">
            <div className="text-sm font-semibold">New Entry</div>
            {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}
            <div className="mt-3 space-y-3">
              <input
                value={patientId}
                onChange={(e) => setPatientId(e.target.value.replace(/\D+/g, ""))}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="Patient ID"
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
              <div className="grid grid-cols-3 gap-2">
                {ID_KEYPAD_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onIdKeyTap(key)}
                    className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                      key === "CLR"
                        ? "bg-rose-600 text-white hover:bg-rose-700"
                        : key === "⌫"
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "border border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Gender</div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setGender("Male")} className={`rounded-xl px-3 py-2 text-sm ${gender === "Male" ? "bg-slate-700 text-white" : "border border-zinc-200 dark:border-zinc-700"}`}>Male</button>
                  <button type="button" onClick={() => setGender("Female")} className={`rounded-xl px-3 py-2 text-sm ${gender === "Female" ? "bg-slate-700 text-white" : "border border-zinc-200 dark:border-zinc-700"}`}>Female</button>
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Age</div>
                <div className="grid grid-cols-4 gap-2">
                  {AGE_GROUPS.map((group) => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => setAgeGroup(group)}
                      className={`rounded-xl px-2 py-2 text-xs font-semibold ${
                        ageGroup === group
                          ? "bg-slate-700 text-white"
                          : "border border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {group}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  <span>Diagnosis (choose up to 2)</span>
                  <span>{diagnoses.length}/2 selected</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {DIAGNOSES.map((dx) => (
                    <button
                      key={dx.id}
                      type="button"
                      onClick={() => toggleDiagnosis(dx.name)}
                      className={`rounded-lg border px-2 py-1 text-left text-xs ${
                        isDiagnosisSelected(diagnoses, dx.name)
                          ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-100"
                          : "border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      <div className="font-medium">
                        {dx.id}. {dx.name}
                      </div>
                      <div className="text-[10px] opacity-80">{dx.category}</div>
                    </button>
                  ))}
                </div>
                {hasInfectiousDiagnosis(diagnoses) ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
                    <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                      Infectious disease details
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {INFECTIOUS_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setInfectiousChoice(opt)}
                          className={`rounded-lg px-2 py-1 text-xs ${
                            infectiousChoice === opt
                              ? "bg-slate-700 text-white"
                              : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {infectiousChoice === INFECTIOUS_OTHER_LABEL ? (
                      <input
                        value={infectiousOtherText}
                        onChange={(e) => setInfectiousOtherText(e.target.value)}
                        placeholder="Write rare infectious disease..."
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
              {showWwField ? (
                <div>
                  <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">WW</div>
                  <div>
                    <label className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-950">
                      <input
                        type="checkbox"
                        checked={warWounded}
                        onChange={(e) => setWarWounded(e.target.checked)}
                      />
                      WW
                    </label>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="mb-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">Disposition</div>
                <div className="grid grid-cols-2 gap-2">
                  {DISPOSITIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDisposition(d)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                        disposition === d
                          ? "bg-slate-700 text-white"
                          : "border border-zinc-200 bg-white hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={saveEntry} className="w-full rounded-xl bg-slate-600 px-3 py-2 text-sm font-semibold text-white">Save & New</button>
              {toast ? (
                <div>
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
            </div>
          </div>
          ) : null}

          {currentView !== "new" ? (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3">
            {currentView === "data" ? (
              <div className="mb-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  Filters
                </div>
                <div className="mb-2 text-xs text-zinc-600 dark:text-zinc-400">
                  Filter patients from a start date to an end date.
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                  {authUser?.role === "admin" ? (
                    <select
                      value={doctorFilter}
                      onChange={(e) => setDoctorFilter(e.target.value)}
                      aria-label="Filter by doctor"
                      className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    >
                      <option value="">All doctors</option>
                      {doctorOptions.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <input
                    value={patientIdFilter}
                    onChange={(e) => setPatientIdFilter(e.target.value.replace(/\D+/g, ""))}
                    placeholder="Search by patient ID"
                    aria-label="Search by patient ID"
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">From date</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value);
                        setQuickRange("custom");
                      }}
                      aria-label="From date"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">To date</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value);
                        setQuickRange("custom");
                      }}
                      aria-label="To date"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const t = todayYmd();
                      setFromDate(t);
                      setToDate(t);
                      setQuickRange("daily");
                      showToast("success", "Daily filter applied.");
                    }}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      quickRange === "daily"
                        ? "bg-slate-700 text-white"
                        : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    Daily
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFromDate(startOfWeekYmd());
                      setToDate(todayYmd());
                      setQuickRange("weekly");
                      showToast("success", "Weekly filter applied.");
                    }}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      quickRange === "weekly"
                        ? "bg-slate-700 text-white"
                        : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    Weekly
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFromDate(startOfMonthYmd());
                      setToDate(todayYmd());
                      setQuickRange("monthly");
                      showToast("success", "Monthly filter applied.");
                    }}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      quickRange === "monthly"
                        ? "bg-slate-700 text-white"
                        : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFromDate("");
                      setToDate("");
                      setDoctorFilter("");
                      setPatientIdFilter("");
                      setQuickRange("");
                      showToast("success", "Filters reset.");
                    }}
                    className="rounded-lg border border-amber-300 bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100 dark:hover:bg-amber-900/50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : null}
            {currentView === "summary" ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 text-center text-sm md:grid-cols-4">
                  <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">Total: {counts.total}</div>
                  <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">Male: {counts.male}</div>
                  <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">Female: {counts.female}</div>
                  <div className="rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
                    Surgical WW/Non: {stats.surgicalWw}/{stats.surgicalNonWw}
                  </div>
                </div>

                <div className="mb-3 grid grid-cols-1 gap-3">
                  <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                      Age Breakdown
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {AGE_GROUPS.map((group) => (
                        <div key={group} className="rounded-lg bg-zinc-100 px-2 py-1 text-center dark:bg-zinc-800">
                          {group}: {stats.ageBreakdown[group]}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mb-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Age x Gender
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 dark:border-zinc-800">
                          <th className="px-2 py-1">Age Group</th>
                          <th className="px-2 py-1">Male</th>
                          <th className="px-2 py-1">Female</th>
                        </tr>
                      </thead>
                      <tbody>
                        {AGE_GROUPS.map((group) => (
                          <tr key={group} className="border-b border-zinc-100 dark:border-zinc-900">
                            <td className="px-2 py-1">{group}</td>
                            <td className="px-2 py-1">{stats.ageByGender[group].Male}</td>
                            <td className="px-2 py-1">{stats.ageByGender[group].Female}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mb-3 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                    Top Diagnoses
                  </div>
                  {stats.topDiagnoses.length === 0 ? (
                    <div className="text-zinc-500 dark:text-zinc-400">No data yet</div>
                  ) : (
                    <div className="space-y-1">
                      {stats.topDiagnoses.map(([name, count]) => (
                        <div key={name} className="flex items-center justify-between rounded-lg bg-zinc-100 px-2 py-1 dark:bg-zinc-800">
                          <span>{name}</span>
                          <span className="font-semibold">{count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
            {currentView === "data" ? (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={exportExcel}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold text-white"
              >
                <Download className="h-4 w-4" /> Export Excel (Filtered)
              </button>
            </div>
            ) : null}
            {currentView === "data" ? (
            <div className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              {hasActiveFilters
                ? `Filtered patients: ${filteredEntries.length}`
                : `Total patients: ${entries.length}`}
            </div>
            ) : null}
            {currentView === "data" ? (
            <>
            <div className="overflow-x-auto">
              <table className="w-max border-collapse text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-zinc-100 dark:bg-zinc-800/60">
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">#</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Date</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Time</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Patient ID</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Gender</th>
                    <th className="border border-zinc-200 px-3 py-2 whitespace-nowrap dark:border-zinc-800">Age</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Category</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Dx No(s)</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Dx Name(s)</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">WW</th>
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Disposition</th>
                    {authUser?.role === "admin" ? (
                      <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Created By</th>
                    ) : null}
                    <th className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedEntries.map((row, index) => (
                    <tr key={row.id} className="odd:bg-white even:bg-zinc-50 dark:odd:bg-zinc-900 dark:even:bg-zinc-950/50">
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{(safePage - 1) * PAGE_SIZE + index + 1}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{formatDate(row.createdAt)}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.time}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.patientId}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.gender}</td>
                      <td className="border border-zinc-200 px-3 py-2 whitespace-nowrap dark:border-zinc-800">{row.ageGroup ?? "-"}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{entryCategoryText(row.diagnoses)}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{diagnosisNumbersText(row.diagnoses)}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.diagnoses.join(" / ")}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.warWounded ? "Yes" : "No"}</td>
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.disposition}</td>
                      {authUser?.role === "admin" ? (
                        <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">{row.createdByUsername ?? "unknown"}</td>
                      ) : null}
                      <td className="border border-zinc-200 px-2 py-2 dark:border-zinc-800">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => beginEditEntry(row)}
                            className="rounded-lg border border-zinc-200 px-2 py-1 text-xs font-semibold dark:border-zinc-700"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteEntry(row)}
                            className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 dark:border-red-800 dark:text-red-300"
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="text-zinc-600 dark:text-zinc-400">
                Page {safePage} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-50 dark:border-zinc-700"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-semibold disabled:opacity-50 dark:border-zinc-700"
                >
                  Next
                </button>
              </div>
            </div>
            </>
            ) : null}
          </div>
          ) : null}
        </div>
      </div>

      <div className="mt-8 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        المهندسة لما أحمد الدربي{" "}
        <a href="mailto:lamaadirbi@gmail.com" className="font-semibold hover:underline">
          lamaadirbi@gmail.com
        </a>
      </div>

      {adminOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Admin user management"
        >
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setAdminOpen(false)} />
          <div className="relative my-4 w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:my-0 sm:max-h-[85vh] sm:overflow-hidden">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Admin - Users</div>
              <button
                type="button"
                onClick={() => setAdminOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950"
              >
                Close
              </button>
            </div>
            <div className="grid max-h-[80vh] grid-cols-1 gap-3 overflow-auto lg:max-h-full lg:grid-cols-5">
              <div className="lg:col-span-2">
                <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-200">Create user</div>
                  <div className="space-y-2">
                    <input value={createUserForm.name} onChange={(e) => setCreateUserForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
                    <input value={createUserForm.username} onChange={(e) => setCreateUserForm((p) => ({ ...p, username: e.target.value }))} placeholder="Username" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
                    <input value={createUserForm.password} onChange={(e) => setCreateUserForm((p) => ({ ...p, password: e.target.value }))} placeholder="Password" type="password" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
                    <select value={createUserForm.role} onChange={(e) => setCreateUserForm((p) => ({ ...p, role: e.target.value as "user" | "admin" }))} aria-label="Role" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                      <option value="user">user</option>
                      <option value="admin">admin</option>
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
                          setCreateUserForm({ name: "", username: "", password: "", role: "user" });
                          showToast("success", "User created successfully.");
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : "Create failed";
                          setAdminError(msg);
                          showToast("error", msg);
                        } finally {
                          setAdminLoading(false);
                        }
                      }}
                      className="w-full rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {adminLoading ? "Working..." : "Create"}
                    </button>
                    {adminError ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-900">{adminError}</div> : null}
                  </div>
                </div>
              </div>
              <div className="lg:col-span-3">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <div className="border-b border-zinc-200 px-3 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:text-zinc-200">Users ({adminUsers.length})</div>
                  <div className="max-h-[55vh] overflow-auto">
                    <table className="w-full border-separate border-spacing-0 text-xs">
                      <thead>
                        <tr className="text-left font-semibold text-zinc-600 dark:text-zinc-300">
                          <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Username</th>
                          <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Name</th>
                          <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Role</th>
                          <th className="sticky top-0 bg-zinc-100 px-3 py-2 dark:bg-zinc-800/60">Status</th>
                          <th className="sticky top-0 bg-zinc-100 px-3 py-2 text-right dark:bg-zinc-800/60">Actions</th>
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
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  aria-label="Edit user"
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
                                  className="rounded-md p-1 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={u.is_active ? "Disable user" : "Enable user"}
                                  disabled={u.id === authUser?.id}
                                  onClick={async () => {
                                    setAdminLoading(true);
                                    try {
                                      await updateUser(u.id, { is_active: !u.is_active });
                                      await reloadAdminUsers();
                                      showToast("success", u.is_active ? "User disabled." : "User enabled.");
                                    } catch (e) {
                                      showToast("error", e instanceof Error ? e.message : "Update failed");
                                    } finally {
                                      setAdminLoading(false);
                                    }
                                  }}
                                  className="rounded-md p-1 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
                                >
                                  <Ban className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Delete user"
                                  disabled={u.id === authUser?.id}
                                  onClick={() => setUserDelete(u)}
                                  className="rounded-md p-1 transition-colors hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setUserEditing(null)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Edit user</div>
              <button type="button" onClick={() => setUserEditing(null)} className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950">Close</button>
            </div>
            <div className="space-y-2">
              <input value={userEditForm.name} onChange={(e) => setUserEditForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              <input value={userEditForm.username} onChange={(e) => setUserEditForm((p) => ({ ...p, username: e.target.value }))} placeholder="Username" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              <input value={userEditForm.email} onChange={(e) => setUserEditForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email (optional)" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              <input value={userEditForm.password} onChange={(e) => setUserEditForm((p) => ({ ...p, password: e.target.value }))} placeholder="New password (optional)" type="password" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" />
              <div className="grid grid-cols-2 gap-2">
                <select value={userEditForm.role} onChange={(e) => setUserEditForm((p) => ({ ...p, role: e.target.value as "user" | "admin" }))} aria-label="Edit role" className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
                <label className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold dark:border-zinc-800 dark:bg-zinc-950">
                  <span>Active</span>
                  <input type="checkbox" checked={userEditForm.is_active} onChange={(e) => setUserEditForm((p) => ({ ...p, is_active: e.target.checked }))} />
                </label>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setUserEditing(null)} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-950">Cancel</button>
              <button
                type="button"
                disabled={userEditSaving}
                onClick={async () => {
                  if (!userEditing) return;
                  setUserEditSaving(true);
                  try {
                    const payload: Parameters<typeof updateUser>[1] = {
                      name: userEditForm.name.trim(),
                      username: userEditForm.username.trim(),
                      email: userEditForm.email.trim() ? userEditForm.email.trim() : null,
                      role: userEditForm.role,
                      is_active: userEditForm.is_active,
                    };
                    if (userEditForm.password.trim()) payload.password = userEditForm.password.trim();
                    await updateUser(userEditing.id, payload);
                    await reloadAdminUsers();
                    if (userEditing.id === authUser?.id) {
                      const u = await fetchCurrentUser();
                      setAuthUser(u);
                    }
                    setUserEditing(null);
                    showToast("success", "User updated successfully.");
                  } catch (e) {
                    showToast("error", e instanceof Error ? e.message : "Update failed");
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

      {userDelete ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setUserDelete(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Delete user</div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Are you sure you want to delete <span className="font-semibold">{userDelete.username}</span>?
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setUserDelete(null)} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-950">Cancel</button>
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
                    showToast("success", "User deleted successfully.");
                  } catch (e) {
                    showToast("error", e instanceof Error ? e.message : "Delete failed");
                  } finally {
                    setUserDeleteSaving(false);
                  }
                }}
                className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {userDeleteSaving ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingEntry ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center overflow-y-auto p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setEditingEntry(null)} />
          <div className="relative my-4 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="mb-3 text-sm font-semibold">Edit Patient</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input value={editForm.patientId} onChange={(e) => setEditForm((p) => ({ ...p, patientId: e.target.value.replace(/\D+/g, "") }))} placeholder="Patient ID" className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" />
              <select value={editForm.gender} onChange={(e) => setEditForm((p) => ({ ...p, gender: e.target.value as "Male" | "Female" }))} aria-label="Gender" className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950">
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {AGE_GROUPS.map((group) => (
                <button key={group} type="button" onClick={() => setEditForm((p) => ({ ...p, ageGroup: group }))} className={`rounded-xl px-2 py-2 text-xs font-semibold ${editForm.ageGroup === group ? "bg-slate-700 text-white" : "border border-zinc-200 dark:border-zinc-700"}`}>
                  {group}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DIAGNOSES.map((dx) => (
                <button key={`edit-${dx.id}`} type="button" onClick={() => toggleDiagnosisForEdit(dx.name)} className={`rounded-lg border px-2 py-1 text-left text-xs ${isDiagnosisSelected(editForm.diagnoses, dx.name) ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-100" : "border-zinc-200 dark:border-zinc-700"}`}>
                  {dx.id}. {dx.name}
                </button>
              ))}
            </div>
            {hasInfectiousDiagnosis(editForm.diagnoses) ? (
              <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-700">
                <div className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Infectious disease details
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {INFECTIOUS_OPTIONS.map((opt) => (
                    <button
                      key={`edit-opt-${opt}`}
                      type="button"
                      onClick={() => setEditInfectiousChoice(opt)}
                      className={`rounded-lg px-2 py-1 text-xs ${
                        editInfectiousChoice === opt
                          ? "bg-slate-700 text-white"
                          : "border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {editInfectiousChoice === INFECTIOUS_OTHER_LABEL ? (
                  <input
                    value={editInfectiousOtherText}
                    onChange={(e) => setEditInfectiousOtherText(e.target.value)}
                    placeholder="Write rare infectious disease..."
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                ) : null}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DISPOSITIONS.map((d) => (
                <button key={`edit-d-${d}`} type="button" onClick={() => setEditForm((p) => ({ ...p, disposition: d }))} className={`rounded-xl px-3 py-2 text-sm font-semibold ${editForm.disposition === d ? "bg-slate-700 text-white" : "border border-zinc-200 dark:border-zinc-700"}`}>
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setEditingEntry(null)} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-950">Cancel</button>
              <button type="button" onClick={saveEditedEntry} className="flex-1 rounded-xl bg-slate-600 px-3 py-2 text-sm font-medium text-white">Save</button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteEntry ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setDeleteEntry(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Delete patient</div>
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
              Are you sure you want to delete patient ID <span className="font-semibold">{deleteEntry.patientId}</span>?
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setDeleteEntry(null)} className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium dark:border-zinc-800 dark:bg-zinc-950">Cancel</button>
              <button type="button" onClick={confirmDeleteEntry} className="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-medium text-white">Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
