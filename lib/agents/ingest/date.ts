/**
 * Normalize a bank-statement date string to ISO `YYYY-MM-DD`, or `""` if it is
 * not a valid date.
 *
 * Clustering buckets by `iso.slice(0, 7)` (YYYY-MM), so a non-ISO or invalid
 * date (Finom's `03.06.2026 11:26:05`, or a typo'd `31.02.2026`) MUST be
 * normalized or rejected — otherwise recurrence detection silently breaks.
 * European day-first ordering is assumed for ambiguous separators.
 */
export function parseDateToIso(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";

  // ISO YYYY-MM-DD (optionally with a time suffix)
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);

  // YYYY/MM/DD or YYYY.MM.DD (year-first)
  m = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);

  // DD.MM.YYYY · DD/MM/YYYY · DD-MM-YYYY (European day-first), 4-digit year
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return iso(m[3], m[2], m[1]);

  // DD.MM.YY (2-digit year), 1970–2069 pivot
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})(?!\d)/);
  if (m) {
    const yy = Number(m[3]);
    return iso(String(yy <= 69 ? 2000 + yy : 1900 + yy), m[2], m[1]);
  }

  return ""; // unknown format → empty (caller drops the row)
}

/** Build an ISO date, rejecting impossible days (incl. leap years) → "". */
function iso(year: string, month: string, day: string): string {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d
  ) {
    return "";
  }
  return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
