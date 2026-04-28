export type AuthUser = {
  id: number;
  name: string;
  username: string;
  email: string;
  role: "admin" | "user" | "doctor" | "doctor_admin" | "nurse" | "nurse_admin";
  is_active?: boolean;
};

const TOKEN_KEY = "authToken";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

