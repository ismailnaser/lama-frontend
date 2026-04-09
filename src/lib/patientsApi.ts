import { API_BASE_URL } from "./config";

export type Sex = "M" | "F";

export type Patient = {
  id: number;
  id_no: string;
  sex: Sex;
  age: number;
  ww: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientFilters = {
  id_no?: string;
  date?: string;
  from_date?: string;
  to_date?: string;
};

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
  const res = await fetch(`${API_BASE_URL}/patients${toQueryString(filters)}`, {
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
  ww?: string;
}) {
  const res = await fetch(`${API_BASE_URL}/patients`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id_no: input.id_no,
      sex: input.sex,
      age: input.age,
      ww: input.ww?.trim() ? input.ww.trim() : null,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { data: Patient };
  return json.data;
}

export async function exportPatientsExcel(filters: PatientFilters) {
  const res = await fetch(`${API_BASE_URL}/patients/excel${toQueryString(filters)}`, {
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
  const res = await fetch(`${API_BASE_URL}/patients/count`, { cache: "no-store" });
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
    ww: string | null;
  }>
) {
  const res = await fetch(`${API_BASE_URL}/patients/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  const json = (await res.json()) as { data: Patient };
  return json.data;
}

export async function deletePatient(id: number) {
  const res = await fetch(`${API_BASE_URL}/patients/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
}

