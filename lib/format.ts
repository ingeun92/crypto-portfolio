export function fmtKrw(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return "₩" + Math.round(n).toLocaleString("en-US");
}

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtKrwCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_0000_0000) return `₩${(n / 1_0000_0000).toFixed(2)}억`;
  if (abs >= 1_0000) return `₩${(n / 1_0000).toFixed(1)}만`;
  return fmtKrw(n);
}

/**
 * Deterministic KST timestamp formatter. We assemble from numeric parts
 * instead of relying on toLocaleString's locale text — Node and the browser
 * ship different ICU data, which causes hydration mismatches ("PM" vs "오후").
 */
export function fmtKstDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${g("year")}.${g("month")}.${g("day")} ${g("hour")}:${g("minute")} KST`;
}
