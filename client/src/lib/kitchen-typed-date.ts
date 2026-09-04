/** Resolve a typed YYYY-MM-DD against a loaded month-availability map. */
export function evaluateTypedKitchenDate(
  dateStr: string,
  availability: Record<string, boolean>,
  todayStr: string
): "empty" | "past" | "pending" | "available" | "unavailable" {
  if (!dateStr) return "empty";
  if (dateStr < todayStr) return "past";
  if (!(dateStr in availability)) return "pending";
  return availability[dateStr] ? "available" : "unavailable";
}

/** Parse YYYY-MM-DD as a local calendar day (no UTC shift). */
export function parseLocalDateInput(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const y = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(y, month, day);
  if (d.getFullYear() !== y || d.getMonth() !== month || d.getDate() !== day) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}
