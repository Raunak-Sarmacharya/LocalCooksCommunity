import type { AvailableSupportAction, SupportActionType } from "@shared/booking-support";

export type { AvailableSupportAction, SupportActionType };
export type SupportStatus = "executing" | "verified" | "failed" | "recovery_required";
export type ActingFor = "chef" | "manager" | "local_cooks";
export type RequestSource = "message" | "call" | "email" | "in_person" | "proactive";

export type SearchRow = {
  bookingId: number; referenceCode: string; status: string; paymentStatus: string | null;
  chefName: string | null; managerName: string | null; kitchenName: string | null;
  bookingDate: string; startTime: string; endTime: string; timezone: string;
};

export type Party = { id: number | null; name: string | null; email: string | null; phone: string | null };

export type CaseVisit = {
  visitDate?: string | null; startTime?: string; endTime?: string; pricingMode?: string | null; scheduleRevision?: number | null; scheduleState?: string | null;
  id: number; blockIndex: number; checkinStatus: string | null; updatedAt: string;
  checkedInAt: string | null; checkoutRequestedAt: string | null; checkoutApprovedAt: string | null;
};
export type CaseVisitCode = {
  targetKey: string; visitId: number | null; mode: string; codeRequired: boolean; locked: boolean;
  consumed: boolean; consumedAt: string | null; consumedMethod: string | null; revoked: boolean;
};
export type CaseItem = { id: number; status: string; paymentStatus: string | null; totalPriceCents: number };
export type CaseFlag = { id: number; kind: "chargeback" | "payout_failed" | "transfer_failed" | "manual_hold"; providerRef: string | null; openedAt: string };

export type SupportActionRecord = {
  id: number; type: string; actorUserId: number; actingFor: ActingFor; requestSource: RequestSource;
  sourceRef: string | null; reasonCode: string; amountCents: number | null; currency: string;
  fundedBy: string; exception: boolean; operationKey: string; status: SupportStatus;
  createdAt: string; completedAt: string | null; notifiedEventIds: number[];
};

export type ChronologyEntry =
  | { source: "lifecycle"; id: number; kind: string; title: string; createdAt: string; completedAt: string | null }
  | { source: "payment"; id: number; kind: string; title: string | null; createdAt: string }
  | { source: "email"; id: number; title: string; status: string; recipientEmail: string | null; trackingId: string | null; createdAt: string }
  | { source: "problem"; id: number; title: string | null; status: string; createdAt: string }
  | ({ source: "support"; title: string } & SupportActionRecord);

export type CloseoutVisit = { key?: string; visitId?: number; blockIndex: number; phase?: string; inspection?: { outcome?: string; dueAt?: string | null } };

export type SupportCase = {
  scheduleRevision?: number;
  dayMoney?: import('@shared/booking-day-money').BookingDayMoney[];
  outsideRefunds?: Array<{ refundId: string; amountCents: number }>;
  dayCancellation?: { remainingVisitIds: number[]; error?: string | null; all: DayCancellationPreview | null; days: Array<DayCancellationPreview & { visitId: number; date: string | null }> } | null;
  refundOperations?: Array<{ transactionId: number; refundOperationId: string; itemName: string; amountCents: number | null; status: string; acceptedAt: string; hasReceipt: boolean }>;
  kitchenRefundDebts?: Array<{ operationId: string; itemName: string; amountCents: number; status: string; recordedAt: string }>;
  cancellationPolicySnapshot?: import('@shared/cancellation-policy').CancellationPolicySnapshot | null;
  payout?: import('@shared/kitchen-payout').KitchenPayout;
  kitchenRefund?: { status: 'pending' | 'succeeded'; amountCents: number; error: string | null; failedAt: string | null; attempts: number; refundId: string | null } | null;
  bookingId: number; referenceCode: string; status: string; paymentStatus: string | null; checkinStatus: string | null;
  updatedAt: string; paymentIntentId: string | null;
  parties: { chef: Party | null; manager: Party | null };
  kitchen: { id: number; name: string } | null;
  location: { id: number; name: string; address: string | null; timezone: string } | null;
  schedule: { timezone: string; zoneLabel: string; blocks: { startAt: string; endAt: string; localStart: string; localEnd: string }[] };
  decision: { state: string; target: string | null } | null;
  /** The kitchen accepted without some equipment; the chef approves the new total before anything is captured. */
  partialAcceptance?: { state: string; deadlineAt: string; proposedAt: string; oldTotalCents: number; newTotalCents: number;
    declined: Array<{ id: number; name: string; cents: number; date?: string }>; answeredAt: string | null; supportReason: string | null } | null;
  deadlines: {
    responseAt: string | null; inspectionAt: string | null; closeoutAt: string | null;
    closeout?: { phase?: string; nextDueAt?: string | null; visits?: CloseoutVisit[] } | null;
  };
  visits: CaseVisit[];
  visitCodes: CaseVisitCode[];
  items: { storage: CaseItem[]; equipment: CaseItem[] };
  money: {
    capturedCents: number; refundedCents: number; platformFeeCents: number; processingFeeCents: number;
    currency: string; providerVerified: boolean;
    dayPayouts?: { installmentId: number; sourceId: number; visitId?: number; operatingDate: string | null; status: string; amountCents: number; feePending: boolean; transferId: string | null; retryReason: string | null }[];
    transfers: { transactionId: number; transferId: string | null; status: string; managerRevenueCents: number; sent?: boolean; sentAt?: string | null; amountCents?: number }[];
  };
  paymentEvidence: {
    id: string; status: string; authorizedCents: number; capturedCents: number; refundedCents: number;
    processingFeeCents: number | null; termsVerified: boolean;
  } | null;
  evidenceUnavailable: boolean;
  cancellationQuote: { quoteHash: string; chefReceivesCents: number; parentVersion: string | number } | null;
  flags: CaseFlag[];
  chronology: ChronologyEntry[];
  supportActions: SupportActionRecord[];
  availableActions: AvailableSupportAction[];
};

export type DayCancellationMoney = { chefReceivesCents: number; managerPaysCents: number; localCooksPaysCents: number };
export type DayCancellationPreview = { forChef?: DayCancellationMoney | null; byKitchen?: DayCancellationMoney | null };

export type ActionResult = {
  action: { id: number; operationKey: string; status: SupportStatus; exception: boolean };
  case: SupportCase;
  replayed: boolean;
};
