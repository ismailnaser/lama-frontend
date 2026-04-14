function tryParseJsonObject(text: string): Record<string, unknown> | null {
  const t = text.trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  const slice = t.slice(start);
  try {
    const j = JSON.parse(slice) as unknown;
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function flattenLaravelErrors(errors: unknown): string[] {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return [];
  const out: string[] = [];
  for (const [field, msgs] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (typeof m === "string" && m.trim()) out.push(`${field}: ${m}`);
      }
    } else if (typeof msgs === "string" && msgs.trim()) {
      out.push(`${field}: ${msgs}`);
    }
  }
  return out;
}

/**
 * Turn Laravel/JSON error bodies into short, user-friendly text.
 */
export function humanizeApiErrorText(text: string, fallback: string): string {
  const raw = text.trim();
  if (!raw) return fallback;

  const j = tryParseJsonObject(raw);
  if (!j) {
    // Strip accidental JSON-ish noise if it's HTML wrapped
    if (raw.length > 240) return `${raw.slice(0, 240)}…`;
    return raw;
  }

  const msg = j.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();

  const errs = flattenLaravelErrors(j.errors);
  if (errs.length) return errs.join("\n");

  return fallback;
}
