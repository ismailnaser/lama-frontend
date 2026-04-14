import { API_BASE_URL } from "./config";
import { setAuthToken, type AuthUser } from "./auth";

export async function login(username: string, password: string) {
  const res = await fetch(`${API_BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Login failed (${res.status})`);
  }

  const json = (await res.json()) as { token: string; user: AuthUser };
  setAuthToken(json.token);
  return json.user;
}

export async function logout() {
  // Best-effort: server logout requires token; local cleanup always happens.
  const token = (() => {
    try {
      return localStorage.getItem("authToken");
    } catch {
      return null;
    }
  })();

  if (token) {
    await fetch(`${API_BASE_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  setAuthToken(null);
}

