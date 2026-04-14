declare global {
  interface Window {
    __LAMA_API_URL__?: string;
  }
}

function normalizeApiUrl(v: string): string {
  const t = v.trim().replace(/\/+$/, "");
  // Ensure it ends with /api (your backend routes are /api/*)
  return t.endsWith("/api") ? t : `${t}/api`;
}

export const API_BASE_URL = (() => {
  // Runtime override for static deployments (no rebuild needed).
  if (typeof window !== "undefined") {
    const w = window.__LAMA_API_URL__;
    if (typeof w === "string" && w.trim()) return normalizeApiUrl(w);
  }

  // Build-time env (works when you rebuild with NEXT_PUBLIC_API_URL set).
  const env = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof env === "string" && env.trim()) return normalizeApiUrl(env);

  // Local dev fallback.
  return "http://127.0.0.1:8000/api";
})();

