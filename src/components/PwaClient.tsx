"use client";

import { Pin, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";

export function PwaClient({ mode = "banner" }: { mode?: "banner" | "header" }) {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);

  const [deferred, setDeferred] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [iosHelpDismissed, setIosHelpDismissed] = useState(false);

  useEffect(() => {
    function onBip(e: Event) {
      e.preventDefault();
      const ev = e as unknown as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      setDeferred(ev);
    }
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  useEffect(() => {
    try {
      const v = localStorage.getItem("pwaIosHelpDismissed");
      if (v === "1") setIosHelpDismissed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS =
    /iPhone|iPad|iPod/i.test(ua) ||
    (ua.includes("Mac") && typeof navigator !== "undefined" && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints > 1);
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);

  async function onInstallClick() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  }

  if (isStandalone) return null;

  if (mode === "header") {
    if (!deferred) return null;
    return (
      <button
        type="button"
        onClick={() => void onInstallClick()}
        className="inline-flex items-center gap-2 rounded-lg bg-slate-600 px-2 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-700 active:bg-slate-800"
        title="Install app"
      >
        <Pin className="h-3.5 w-3.5" />
        Install
      </button>
    );
  }

  return (
    <div className="mb-3 flex flex-col gap-2">
      {isIOS && !iosHelpDismissed ? (
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950 shadow-sm dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-100">
          <Share2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold">Install on iPhone / iPad:</span> tap{" "}
            <span className="font-mono font-bold">Share</span> at the bottom of the screen, then choose{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </div>
          <button
            type="button"
            onClick={() => {
              setIosHelpDismissed(true);
              try {
                localStorage.setItem("pwaIosHelpDismissed", "1");
              } catch {
                /* ignore */
              }
            }}
            className="shrink-0 rounded-lg p-1 text-sky-800 hover:bg-sky-100 dark:text-sky-200 dark:hover:bg-sky-900/50"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {deferred ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-center gap-2 font-medium text-zinc-800 dark:text-zinc-100">
            <Pin className="h-4 w-4 text-slate-600 dark:text-slate-300" aria-hidden />
            <span>Install this app on your device</span>
          </div>
          <button
            type="button"
            onClick={() => void onInstallClick()}
            className="rounded-lg bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-700 active:bg-slate-800 dark:bg-slate-600"
          >
            Install
          </button>
        </div>
      ) : null}
    </div>
  );
}
