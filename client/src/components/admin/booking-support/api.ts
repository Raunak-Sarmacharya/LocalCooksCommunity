import type { SupportActionInput } from "@shared/booking-support";
import type { ActionResult, SearchRow, SupportCase } from "./types";

export class SupportApiError extends Error {
  /** 0 means the request never got an answer (network problem), so the outcome is unknown. */
  constructor(public status: number, message: string) { super(message); }
  get outcomeUnknown() { return this.status === 0 || (this.status >= 500 && this.status !== 503); }
}

export type TokenGetter = () => Promise<string>;

async function call<T>(getToken: TokenGetter, url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const token = await getToken();
    res = await fetch(url, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw new SupportApiError(0, "");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new SupportApiError(res.status, typeof body?.error === "string" ? body.error : "");
  return body as T;
}

export async function searchBookings(getToken: TokenGetter, q: string): Promise<SearchRow[]> {
  const data = await call<{ results: SearchRow[] }>(getToken, `/api/admin/booking-support/search?q=${encodeURIComponent(q)}`);
  return data.results ?? [];
}

export const loadCase = (getToken: TokenGetter, id: number) =>
  call<SupportCase>(getToken, `/api/admin/booking-support/${id}`);

export type AdminBookingFeedback = {
  bookingId: number;
  requestedAt: string | null;
  remindedAt: string | null;
  closesAt: string | null;
  responses: {
    id: number; bookingId: number; respondentId: number; respondentRole: "chef" | "manager";
    rating: number; tags: string[]; comment: string | null; createdAt: string; flagged: boolean;
  }[];
};

export const loadBookingFeedback = (getToken: TokenGetter, bookingId: number) =>
  call<AdminBookingFeedback>(getToken, `/api/admin/bookings/${bookingId}/feedback`);

export const postAction = (getToken: TokenGetter, id: number, body: SupportActionInput) =>
  call<ActionResult>(getToken, `/api/admin/booking-support/${id}/actions`, { method: "POST", body: JSON.stringify(body) });
