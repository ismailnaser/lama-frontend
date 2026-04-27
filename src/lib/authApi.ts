import { buildApiUrl } from "./config";
import { setActiveAppType, setAuthToken, type AppType, type AuthUser } from "./auth";
import { apiFetch } from "./http";
import { humanizeApiErrorText } from "./apiErrors";

export async function login(username: string, password: string, appType: AppType) {
  const res = await apiFetch(buildApiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, app_type: appType }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Login failed (${res.status})`));
  }

  const json = (await res.json()) as { token: string; user: AuthUser };
  setActiveAppType(appType);
  setAuthToken(json.token, appType);
  return json.user;
}

export async function logout() {
  await apiFetch(buildApiUrl("/auth/logout"), { method: "POST" }).catch(() => undefined);
  setAuthToken(null);
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await apiFetch(buildApiUrl("/auth/me"), { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(humanizeApiErrorText(text, `Request failed (${res.status})`));
  }
  const json = (await res.json()) as { user: AuthUser };
  return json.user;
}

