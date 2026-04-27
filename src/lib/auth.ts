export type AuthUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: "admin" | "user";
  app_type: "surgical" | "opd";
  is_active?: boolean;
};

export type AppType = "surgical" | "opd";
const APP_KEY = "activeAppType";
const TOKEN_KEY_PREFIX = "authToken:";

function getTokenStorageKey(appType: AppType) {
  return `${TOKEN_KEY_PREFIX}${appType}`;
}

export function getActiveAppType(): AppType {
  if (typeof window === "undefined") return "surgical";
  try {
    const raw = localStorage.getItem(APP_KEY);
    return raw === "opd" ? "opd" : "surgical";
  } catch {
    return "surgical";
  }
}

export function setActiveAppType(appType: AppType) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(APP_KEY, appType);
  } catch {
    /* ignore */
  }
}

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = localStorage.getItem(getTokenStorageKey(getActiveAppType()));
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null, appType?: AppType) {
  if (typeof window === "undefined") return;
  try {
    const targetApp = appType ?? getActiveAppType();
    const key = getTokenStorageKey(targetApp);
    if (!token) localStorage.removeItem(key);
    else localStorage.setItem(key, token);
  } catch {
    /* ignore */
  }
}

