/** Localized, capitalized label for a booking status; never prints a raw enum value such as "completed". */
const statusKeys: Record<string, string> = {
  pending: 'bdStatusPending',
  confirmed: 'bdStatusConfirmed',
  cancelled: 'bdStatusCancelled',
  completed: 'bkStatusCompleted',
  cancellation_requested: 'bkStatusCancellationPending',
};

export function bookingStatusLabel(status: string, t: (key: string) => string) {
  const key = statusKeys[status];
  if (key) return t(key);
  const readable = status.replace(/_/g, ' ').trim();
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}
