import { API_BASE_URL } from "./config";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";

export type Sex = "M" | "F";

export type Patient = {
  id: number;
  id_no: string;
  sex: Sex;
  age: number;
  created_by?: string;
  room: "room1" | "room2" | null;
  ww: boolean;
  lab: boolean;
  burn: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientFilters = {
  id_no?: string;
  /** Exact match (no partial/LIKE) — use with `date` for same-day duplicate checks */
  id_no_exact?: string;
  date?: string;
  from_date?: string;
  to_date?: string;
};

function errorMessageFromResponseBody(text: string, fallback: string): string {
  return humanizeApiErrorText(text, fallback);
}

function toQueryString(filters: PatientFilters) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && `${v}`.trim() !== "") {
      params.set(k, `${v}`);
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function listPatients(filters: PatientFilters) {
  const res = await apiFetch(`${API_BASE_URL}/patients${toQueryString(filters)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { data: Patient[] };
  return json.data;
}

export async function createPatient(input: {
  id_no: string;
  sex: Sex;
  age: number;
  room: "room1" | "room2";
  ww?: boolean;
  lab?: boolean;
  burn?: boolean;
  notes?: string | null;
}) {
  const res = await apiFetch(`${API_BASE_URL}/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_no: input.id_no,
      sex: input.sex,
      age: input.age,
      room: input.room,
      ww: input.ww ?? false,
      lab: input.lab ?? false,
      burn: input.burn ?? false,
      notes: input.notes?.trim() ? input.notes.trim() : null,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(errorMessageFromResponseBody(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: Patient };
  return json.data;
}

export async function exportPatientsExcel(filters: PatientFilters) {
  const res = await apiFetch(`${API_BASE_URL}/patients/excel${toQueryString(filters)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Excel export failed (${res.status})`);
  }
  const blob = await res.blob();
  return blob;
}

export async function getPatientsCount() {
  const res = await apiFetch(`${API_BASE_URL}/patients/count`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { count: number };
  return json.count;
}

export async function updatePatient(
  id: number,
  input: Partial<{
    id_no: string;
    sex: Sex;
    age: number;
    room: "room1" | "room2";
    ww: boolean;
    lab: boolean;
    burn: boolean;
    notes: string | null;
  }>
) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(errorMessageFromResponseBody(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: Patient };
  return json.data;
}

export async function deletePatient(id: number) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
}

export type PatientAuditLog = {
  id: number;
  action: "created" | "updated" | "deleted";
  username: string | null;
  user_id: number | null;
  changes: { before: unknown; after: unknown } | null;
  created_at: string;
};

export async function getPatientAudits(id: number) {
  const res = await apiFetch(`${API_BASE_URL}/patients/${id}/audits`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { data: PatientAuditLog[] };
  return json.data;
}
