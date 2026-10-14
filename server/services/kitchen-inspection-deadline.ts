/** Same saved review window as chef checkin-status; this projection never closes a visit. */
export function kitchenInspectionDeadline(requestedAt: Date | null, reviewWindowMinutes: number) {
  return requestedAt ? new Date(requestedAt.getTime() + reviewWindowMinutes * 60_000) : null;
}
