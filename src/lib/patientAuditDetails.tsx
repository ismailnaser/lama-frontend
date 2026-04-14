import type { PatientAuditLog } from "./patientsApi";

type PatientSnapshot = {
  id_no?: unknown;
  sex?: unknown;
  age?: unknown;
  ww?: unknown;
  notes?: unknown;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asSnapshot(v: unknown): PatientSnapshot | null {
  if (!isRecord(v)) return null;
  return v as PatientSnapshot;
}

function fmtSex(v: unknown): string {
  if (v === "M") return "Male (M)";
  if (v === "F") return "Female (F)";
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function fmtBool(v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === 1 || v === "1" || v === "true" || v === "yes") return "Yes";
  if (v === 0 || v === "0" || v === "false" || v === "no") return "No";
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

function fmtNotes(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : "—";
}

function fmtIdNo(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
  return t ? t : "—";
}

function fmtAge(v: unknown): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return String(Number(v));
  return "—";
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-[92px] shrink-0 font-semibold text-zinc-700 dark:text-zinc-200">{label}</div>
      <div className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function ChangeLine({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="font-semibold text-zinc-800 dark:text-zinc-100">{label}</div>
      <div className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">From:</span>{" "}
        <span className="text-zinc-800 dark:text-zinc-100">{from}</span>
      </div>
      <div className="mt-0.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">To:</span>{" "}
        <span className="text-zinc-800 dark:text-zinc-100">{to}</span>
      </div>
    </div>
  );
}

export function PatientAuditDetails({ log }: { log: PatientAuditLog }) {
  const changes = log.changes;
  if (!isRecord(changes)) {
    return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">No details.</div>;
  }

  const before = asSnapshot(changes.before);
  const after = asSnapshot(changes.after);

  if (log.action === "created") {
    if (!after) return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">No details.</div>;
    return (
      <div className="space-y-1.5 text-[11px] leading-relaxed">
        <div className="font-semibold text-zinc-800 dark:text-zinc-100">Record created with:</div>
        <Row label="ID No" value={fmtIdNo(after.id_no)} />
        <Row label="Sex" value={fmtSex(after.sex)} />
        <Row label="Age" value={fmtAge(after.age)} />
        <Row label="WW" value={fmtBool(after.ww)} />
        <Row label="Notes" value={fmtNotes(after.notes)} />
      </div>
    );
  }

  if (log.action === "deleted") {
    if (!before) return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">No details.</div>;
    return (
      <div className="space-y-1.5 text-[11px] leading-relaxed">
        <div className="font-semibold text-zinc-800 dark:text-zinc-100">Record deleted. Last values were:</div>
        <Row label="ID No" value={fmtIdNo(before.id_no)} />
        <Row label="Sex" value={fmtSex(before.sex)} />
        <Row label="Age" value={fmtAge(before.age)} />
        <Row label="WW" value={fmtBool(before.ww)} />
        <Row label="Notes" value={fmtNotes(before.notes)} />
      </div>
    );
  }

  if (log.action === "updated") {
    if (!before || !after) return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">No details.</div>;

    const keys: Array<keyof PatientSnapshot> = ["id_no", "sex", "age", "ww", "notes"];
    const labels: Record<keyof PatientSnapshot, string> = {
      id_no: "ID No",
      sex: "Sex",
      age: "Age",
      ww: "WW",
      notes: "Notes",
    };

    const formatters: Record<keyof PatientSnapshot, (v: unknown) => string> = {
      id_no: fmtIdNo,
      sex: fmtSex,
      age: fmtAge,
      ww: fmtBool,
      notes: fmtNotes,
    };

    const diffs: Array<keyof PatientSnapshot> = [];
    for (const k of keys) {
      const bv = before[k];
      const av = after[k];
      if (JSON.stringify(bv) === JSON.stringify(av)) continue;
      diffs.push(k);
    }

    if (diffs.length === 0) {
      return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">Updated (no field changes detected).</div>;
    }

    return (
      <div className="space-y-2 text-[11px] leading-relaxed">
        <div className="font-semibold text-zinc-800 dark:text-zinc-100">Changes</div>
        {diffs.map((k) => (
          <ChangeLine
            key={k}
            label={labels[k]}
            from={formatters[k](before[k])}
            to={formatters[k](after[k])}
          />
        ))}
      </div>
    );
  }

  return <div className="text-[11px] text-zinc-600 dark:text-zinc-300">Unknown action.</div>;
}
