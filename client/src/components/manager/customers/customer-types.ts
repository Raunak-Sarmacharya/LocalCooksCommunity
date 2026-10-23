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

export type Rental = { name: string; days: number };
export type PageBooking = {
  bookingId: number; reference: string | null; kitchenName: string; startsAt: string | null; endsAt: string | null; status: string;
  responseDeadlineAt: string | null; rentals: Rental[];
};
export type BookingOutcomeCode =
  | 'completed_cleared' | 'completed' | 'claim_filed' | 'attendance_reported' | 'cancelled_by_customer' | 'cancelled_by_you'
  | 'cancelled' | 'visit_ended' | 'request_unanswered' | 'cancellation_requested';
export type PastBooking = PageBooking & { outcome: BookingOutcomeCode; refundedCents: number; late: boolean; noShow: 'counted' | 'under_review' | null };
export type ClaimActor = 'you' | 'customer' | 'local_cooks' | 'nobody';

export type CustomerDocument = {
  key: 'foodSafetyLicense' | 'foodEstablishmentCert' | 'insurance'; mode: 'none' | 'track' | 'required'; required: boolean; uploaded: boolean; status: string; expiry: string | null;
  daysLeft: number | null; stage: 'expired' | '3_day' | '14_day' | '45_day' | null; url: string | null; renewalPending: boolean;
};
type VisitRef = { bookingId?: number; reference?: string | null; startsAt?: string | null; endsAt?: string | null };
export type OpenItem = VisitRef & {
  kind: 'storage_move_in' | 'booking_request' | 'cancellation_request' | 'no_show_review' | 'problem' | 'claims' | 'next';
  owner: 'you' | 'customer' | 'local_cooks';
  storageId?: number; name?: string; startOn?: string | null; endOn?: string | null; deadlineAt?: string | null; count?: number; amountCents?: number; references?: string[];
};
export type ActivityItem = VisitRef & {
  at: string; type: 'booked' | 'requested' | 'cancelled' | 'rental_day_cancelled' | 'visit_ended' | 'no_show_reported' | 'no_show_disputed' | 'claim_filed'
    | 'storage_rented' | 'applied' | 'local_cooks_approved' | 'documents_sent' | 'access_approved';
  category: 'booking' | 'money' | 'access'; actor: 'you' | 'customer' | 'local_cooks';
  amountCents?: number; refundedCents?: number; rentals?: Rental[]; name?: string; date?: string; status?: string; startOn?: string | null; endOn?: string | null;
};
export type StorageRow = { id: number; reference: string | null; name: string; state: string; endReason: string | null; startOn: string | null; endOn: string | null; totalCents: number; moveInOverdue: boolean };
export type PaymentRow = VisitRef & {
  id: number; paidAt: string | null; status: string; amountCents: number; refundedCents: number;
  payoutCents: number | null; payoutStatus: 'scheduled' | 'on_hold' | 'sent' | 'not_applicable' | null; payoutAt: string | null;
};
export type CustomerPageData = {
  customer: {
    chefId: number; name: string; businessName: string | null; email: string | null; phone: string | null;
    customerSince: string | null; firstContactAt: string | null; businessType: string | null; usageFrequency: string | null; sessionDuration: string | null;
  };
  location: { id: number; name: string; timezone: string };
  locations: { id: number; name: string; timezone: string; status: CustomerStatus; needsAction: boolean; bookingCount: number }[];
  status: CustomerStatus;
  next: CustomerNextAction;
  actions: { applicationId: number | null; canInvite: boolean; canRevoke: boolean; canReview: boolean; revokedNote: boolean };
  reliability: {
    visits: number; hoursInKitchen: number; lastVisitEndedAt: string | null; nextVisit: { bookingId: number; startsAt: string; endsAt: string } | null;
    cancelledByCustomer: number; lateCancellations: number; noShowsCounted: number; noShowsUnderReview: number;
  };
  bookingCounts: { upcoming: number; past: number; cancelled: number };
  open: OpenItem[];
  upcoming: PageBooking[];
  past: PastBooking[]; pastTotal: number; pastHasMore: boolean;
  application: null | {
    id: number; status: string; tier: number;
    stages: { key: 'requested' | 'localCooksApproved' | 'documentsSubmitted' | 'youApproved'; at: string | null }[];
    documents: CustomerDocument[];
  };
  tours: { id: number; scheduledAt: string; durationMinutes: number; status: string; kitchenName: string | null; feedbackSubmitted: boolean }[];
  money: { paidCents: number; refundedCents: number; heldCents: number; outstandingCents: number; currency: string; paymentCount: number; holdCount: number;
    claimsCollectedCents: number; claimsCollectedCount: number };
  payments: PaymentRow[];
  storage: StorageRow[];
  activity: ActivityItem[];
  claims: { id: number; reference: string | null; title: string; status: string; amountCents: number | null; nextActor: ClaimActor; deadlineAt: string | null; bookingId: number | null }[];
};

export type CustomerNote = { id: number; body: string; authorId: number | null; authorName: string | null; mine: boolean; createdAt: string; updatedAt: string; edited: boolean };
