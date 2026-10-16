import type {
  CustomerActionCode, CustomerFilter, CustomerNextAction, CustomerSort, CustomerStatus,
} from '@shared/customer-next-action';

export type { CustomerActionCode, CustomerFilter, CustomerNextAction, CustomerSort, CustomerStatus };

export type CustomerLocationChip = { locationId: number; locationName: string; timezone: string; status: CustomerStatus; next: CustomerNextAction };
export type CustomerNextBooking = { bookingId: number; locationId: number; kitchenName: string; startsAt: string; endsAt: string; timezone: string; status: string };
export type CustomerListRow = {
  chefId: number; name: string; businessName: string | null;
  status: CustomerStatus; next: CustomerNextAction; needsAction: boolean;
  locationId: number; timezone: string;
  locations: CustomerLocationChip[];
  nextBooking: CustomerNextBooking | null;
  openItems: number;
  lastActivityAt: string | null;
};
export type CustomerListResponse = {
  customers: CustomerListRow[];
  counts: Record<CustomerFilter, number>;
  nextCursor: string | null;
  locations: { id: number; name: string; timezone: string }[];
};

export type PageBooking = {
  bookingId: number; reference: string | null; kitchenName: string; startsAt: string | null; endsAt: string | null; status: string;
  responseDeadlineAt: string | null; equipmentCount: number; storageCount: number;
};
export type BookingOutcomeCode =
  | 'completed_cleared' | 'completed' | 'claim_filed' | 'attendance_reported' | 'cancelled_by_customer' | 'cancelled_by_you'
  | 'cancelled' | 'visit_ended' | 'request_unanswered' | 'cancellation_requested';
export type PastBooking = PageBooking & { outcome: BookingOutcomeCode; refundedCents: number };
export type ClaimActor = 'you' | 'customer' | 'local_cooks' | 'nobody';

export type CustomerDocument = {
  key: 'foodSafetyLicense' | 'foodEstablishmentCert'; required: boolean; uploaded: boolean; status: string; expiry: string | null;
  daysLeft: number | null; stage: 'expired' | '7_day' | '30_day' | null; url: string | null; renewalPending: boolean;
};
export type CustomerPageData = {
  customer: { chefId: number; name: string; businessName: string | null; email: string | null; phone: string | null; customerSince: string | null; firstContactAt: string | null };
  location: { id: number; name: string; timezone: string };
  locations: { id: number; name: string; timezone: string; status: CustomerStatus; needsAction: boolean }[];
  status: CustomerStatus;
  next: CustomerNextAction;
  actions: { applicationId: number | null; canInvite: boolean; canRevoke: boolean; canReview: boolean; revokedNote: boolean };
  upcoming: PageBooking[];
  past: PastBooking[]; pastTotal: number; pastHasMore: boolean;
  application: null | {
    id: number; status: string; tier: number;
    stages: { key: 'requested' | 'localCooksApproved' | 'documentsSubmitted' | 'youApproved'; at: string | null }[];
    documents: CustomerDocument[];
  };
  tours: { id: number; scheduledAt: string; durationMinutes: number; status: string; kitchenName: string | null; feedbackSubmitted: boolean }[];
  money: { paidCents: number; refundedCents: number; heldCents: number; outstandingCents: number; currency: string };
  claims: { id: number; reference: string | null; title: string; status: string; amountCents: number | null; nextActor: ClaimActor; deadlineAt: string | null; bookingId: number | null }[];
};

export type CustomerNote = { id: number; body: string; authorId: number | null; authorName: string | null; mine: boolean; createdAt: string; updatedAt: string; edited: boolean };
