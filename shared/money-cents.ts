/**
 * Parse DB/API money fields that may arrive as string | number | numeric.
 * Never use truthiness — 0 is a valid amount.
 */
export function parseCentsField(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function parseCentsFieldOrZero(value: unknown): number {
  return parseCentsField(value) ?? 0;
}
