import { getAuthToken } from "./auth";

export async function apiFetch(input: string, init?: RequestInit) {
  const token = getAuthToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

