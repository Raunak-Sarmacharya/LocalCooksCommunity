/** Canonical English default stored on locations when managers leave the message blank. */
export const EN_CANCELLATION_POLICY_DEFAULT =
  "Bookings cannot be cancelled within {hours} hours of the scheduled time.";

/** Manager-controlled cancellation window copy (hours placeholder filled). */
export function formatCancellationWindowText(
  hours: number,
  customMessage: string | null | undefined,
  translatedDefault: string
): string {
  const raw = typeof customMessage === "string" ? customMessage.trim() : "";
  if (!raw || raw === EN_CANCELLATION_POLICY_DEFAULT) return translatedDefault;
  return raw.replace(/\{hours\}/g, String(hours));
}
