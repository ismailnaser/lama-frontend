import { API_BASE_URL } from "./config";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";

export type AdminUserRow = {
  id: number;
  name: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
  app_type: "surgical" | "opd";
  is_active: boolean;
  created_at: string;
};

export async function listUsers() {
  const res = await apiFetch(`${API_BASE_URL}/users`, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: AdminUserRow[] };
  return json.data;
}

export async function createUser(input: {
  name: string;
  username: string;
  password: string;
  role: "admin" | "user";
  email?: string | null;
}) {
  const res = await apiFetch(`${API_BASE_URL}/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: AdminUserRow };
  return json.data;
}

export async function updateUser(
  id: number,
  input: Partial<{
    name: string;
    username: string;
    password: string;
    role: "admin" | "user";
    email: string | null;
    is_active: boolean;
  }>
) {
  const res = await apiFetch(`${API_BASE_URL}/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { data: AdminUserRow };
  return json.data;
}

export async function deleteUser(id: number) {
  const res = await apiFetch(`${API_BASE_URL}/users/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
}
