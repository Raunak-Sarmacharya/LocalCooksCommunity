/**
 * The booking page "Now" card: for one phase × role, the pill, ONE sentence, at most one primary action, the secondary
 * actions (in order of usefulness; the page shows three and moves the rest to the ⋯ menu), which attention slots may
 * render, and the body. Pure: every time/amount arrives pre-formatted, so the page and its tests share one rule set
 * (design-booking-consolidation.md §2.2/§2.3). Display only; no booking, payment or policy decision is made here.
 * Storage is deliberately absent (§2.8): it gets its own "Now" when it becomes its own product.
 */
import { bookingPillTone, bookingPrimaryAction, sentence as tidy, type BookingHeaderPhase, type BookingPillTone, type BookingPrimaryAction } from './booking-header-state';
import type { BookingCancelCause } from './booking-cancel-cause';

export type NowRole = 'chef' | 'manager';
export type NowSecondary =
  | 'cancel_request' | 'see_arrival_details' | 'add_to_calendar' | 'running_late' | 'arrived_early' | 'need_more_time'
  | 'download_invoice' | 'contact_local_cooks' | 'find_another_time'
  | 'extension_tools' | 'change_booking' | 'fix_record' | 'record_left' | 'report_damage' | 'download_payout_statement' | 'manage_refund';
export type NowAttention = 'extensions' | 'changes' | 'claims';
export type NowBody = 'preparation' | 'code' | 'no_show_message' | null;

export interface BookingNowFacts {
  chef: string;
  kitchen: string;
  cancelCause?: BookingCancelCause | null;
  /** Formatted response deadline of a pending request. */
  responseDeadline?: string | null;
  /** Formatted release time when arrival details are still to come. */
  detailsReleaseAt?: string | null;
  /** Formatted "Jan 15, 9:45 a.m." when check-in opens. */
  opensAt?: string | null;
  startClock?: string | null;
  endClock?: string | null;
  /** Booked end with the zone name ("12:00 p.m. Newfoundland Time"). */
  endWithZone?: string | null;
  /** Booked end (after extensions) of the visit the chef is still checked in to, with the zone name. */
  overstayEndWithZone?: string | null;
  startPassed?: boolean;
  /** The chef already told the kitchen they're late (chef view: the sentence carries it). */
  runningLate?: { duration: string } | null;
  arrivalMode?: string | null;
  checkedInClock?: string | null;
  checkedInMethod?: string | null;
  /** When the chef submitted checkout (chef view). */
  checkoutClock?: string | null;
  inspectionCanRespond?: boolean;
  inspectionDue?: string | null;
  payoutReview?: { amount: string; date: string } | null;
  settledClaim?: { outcome: 'chef_paid' | 'local_cooks_paid' | 'closed'; amount: string } | null;
  hasClaim?: boolean;
  claimDeadline?: string;
  inspectionOutcome?: string | null;
  inspectedOn?: string | null;
  /** Booking status, for the few rules that depend on it beyond the phase. */
  status?: string;
  // Gates computed by the page (server rules stay on the server).
  canCancel?: boolean;
  canAddToCalendar?: boolean;
  runningLateOpen?: boolean;
  canMessage?: boolean;
  canDownload?: boolean;
  managerCanManage?: boolean;
  claimFilingOpen?: boolean;
  findAnotherTime?: boolean;
  /** Arrival details have been released to the chef (or the server is older and always released). */
  detailsReleased?: boolean;
}

export interface BookingNowContent {
  pill: { key: string; tone: BookingPillTone };
  sentence: string;
  primary: BookingPrimaryAction;
  /** Chef only: an open payment (claim or extra-time charge) may take the single primary slot. */
  payMayBePrimary: boolean;
  secondary: NowSecondary[];
  attention: NowAttention[];
  body: NowBody;
}

type T = (key: string, options?: Record<string, unknown>) => string;

function pillKey(phase: BookingHeaderPhase, role: NowRole, cause?: BookingCancelCause | null) {
  if (phase === 'cancelled' && (cause === 'declined' || cause === 'expired')) return `bdhPill_${cause}`;
  if (phase === 'checkout_review' && role === 'chef') return 'bdhPill_checkout_submitted';
  if (phase === 'checkin_open') return 'bdhPill_today';
  if (phase === 'time_ended_in_session') return 'bdhPill_time_ended_in_session';
  return `bdhPill_${phase}`;
}

function chefSentence(phase: BookingHeaderPhase, f: BookingNowFacts, t: T): string {
  const kitchen = f.kitchen;
  switch (phase) {
    case 'pending':
      return f.responseDeadline ? t('bnChefPending', { kitchen, deadline: f.responseDeadline }) : t('bdhNextChefPending', { kitchen });
    case 'cancellation_requested': return t('cancelCopy07');
    case 'cancelled':
      if (f.cancelCause === 'declined' || f.cancelCause === 'expired' || f.cancelCause === 'withdrawn') return t(`bdhNextChef_${f.cancelCause}`, { kitchen });
      return t('bdhNextChefCancelled');
    case 'confirmed':
      if (f.detailsReleaseAt) return t('bnChefDetailsAt', { time: f.detailsReleaseAt });
      return f.opensAt ? t('bdhNextChefDetailsReady', { time: f.opensAt }) : t('bdhNextChefConfirmed');
    case 'today':
      if (f.runningLate && f.endWithZone) return t('bnChefRunningLate', { kitchen, duration: f.runningLate.duration, end: f.endWithZone });
      return f.opensAt ? t('bnChefTodayOpensAt', { time: f.opensAt }) : t('bdhNextChefConfirmed');
    case 'checkin_open':
      if (f.runningLate && f.endWithZone) return t('bnChefRunningLate', { kitchen, duration: f.runningLate.duration, end: f.endWithZone });
      return f.startPassed && f.endWithZone ? t('bnChefCheckinOpenLate', { end: f.endWithZone }) : t('bdhNextChefCheckinOpen');
    case 'in_session': return t('bdhNextChefInSession', { time: f.endClock || '' });
    case 'time_ended_in_session': return t('bnChefTimeEnded', { end: f.overstayEndWithZone || f.endWithZone || '' });
    case 'checkout_review':
      if (f.settledClaim?.outcome === 'chef_paid') return t('booking:bnChefClaimPaid', { amount: f.settledClaim.amount });
      if (f.settledClaim?.outcome === 'closed') return t('booking:bnChefClaimClosed');
      if (f.claimDeadline) return t('booking:bnChefClaimOpen', { kitchen, date: f.claimDeadline });
      return f.checkoutClock ? t('bnChefCheckoutSubmitted', { time: f.checkoutClock }) : t('bnChefCheckoutSubmittedNoTime');
    case 'completed':
      if (f.settledClaim?.outcome === 'chef_paid') return t('booking:bnChefClaimPaid', { amount: f.settledClaim.amount });
      if (f.settledClaim?.outcome === 'closed') return t('booking:bnChefClaimClosed');
      if (f.claimDeadline) return t('booking:bnChefClaimOpen', { kitchen, date: f.claimDeadline });
      // Hidden claims are omitted from the chef response, so a cleared inspection cannot promise “all good”.
      return t('booking:bnVisitComplete');
    case 'visit_ended': return t('bdhNextChefMissed');
    case 'no_show': return t('kciStatusNoShow');
    case 'issue': return t('bnChefIssue', { kitchen });
  }
}

function checkedInFragment(f: BookingNowFacts, t: T) {
  if (!f.checkedInClock) return '';
  const key = f.checkedInMethod === 'code' ? 'bnManagerCheckedInCode' : f.checkedInMethod === 'self' ? 'bnManagerCheckedInSelf' : 'bnManagerCheckedIn';
  return ` ${t(key, { time: f.checkedInClock })}`;
}

function managerSentence(phase: BookingHeaderPhase, f: BookingNowFacts, t: T): string {
  const chef = f.chef;
  switch (phase) {
    case 'pending': return f.responseDeadline ? t('bnManagerPending', { deadline: f.responseDeadline }) : t('bdhNextManagerPending');
    case 'cancellation_requested': return t('bdhNextManagerCancellationRequested', { chef });
    case 'cancelled':
      if (f.cancelCause === 'declined' || f.cancelCause === 'expired' || f.cancelCause === 'withdrawn') return t(`bdhNextManager_${f.cancelCause}`, { chef });
      return t('bdhNextManagerCancelled');
    case 'confirmed': return f.arrivalMode === 'self' ? t('bnManagerUpcomingSelf', { chef }) : t('bdhNextManagerUpcoming', { chef });
    case 'today': return f.startClock ? t('bdhNextManagerToday', { chef, time: f.startClock }) : t('bdhNextManagerUpcoming', { chef });
    case 'checkin_open':
      return !f.startPassed && f.startClock ? t('bdhNextManagerToday', { chef, time: f.startClock }) : t('bdhNextManagerNotArrived', { chef });
    case 'in_session': return `${t('bdhNextManagerInSession', { chef, time: f.endClock || '' })}${checkedInFragment(f, t)}`;
    case 'time_ended_in_session': return t('bdhNextManagerTimeEnded', { chef, end: f.overstayEndWithZone || f.endWithZone || '' });
    case 'checkout_review':
      // The amount is the Payment card's headline; the sentence carries only the action and when it happens anyway.
      if (f.inspectionCanRespond && f.payoutReview) return t('bnManagerReviewPayout', { chef, date: f.payoutReview.date });
      return f.inspectionDue ? t('bdhNextManagerReviewBy', { chef, time: f.inspectionDue }) : t('bdhNextManagerReview', { chef });
    case 'visit_ended':
      return f.inspectionCanRespond && f.inspectionDue ? t('bdhNextManagerInspectBy', { time: f.inspectionDue }) : t('bnManagerMissed', { chef });
    case 'completed':
      if (f.settledClaim) return t(`booking:bnManagerClaim_${f.settledClaim.outcome}`, { chef, amount: f.settledClaim.amount });
      if (f.hasClaim) return t('booking:bnVisitComplete');
      if (f.inspectionOutcome === 'manager_cleared' && f.inspectedOn) return t('bnManagerCompletedInspected', { date: f.inspectedOn });
      if (f.inspectionOutcome === 'auto_closed_uninspected') return t('bnManagerCompletedNoInspection');
      return t('bdhNextManagerCompleted');
    case 'no_show': return t('bdhNextManagerNoShow');
    case 'issue': return t('bnManagerIssue');
  }
}

const BEFORE_START: BookingHeaderPhase[] = ['confirmed', 'today', 'checkin_open'];

function chefSecondary(phase: BookingHeaderPhase, f: BookingNowFacts): NowSecondary[] {
  const out: NowSecondary[] = [];
  switch (phase) {
    case 'pending':
      if (f.canCancel) out.push('cancel_request');
      break;
    case 'confirmed':
      out.push('see_arrival_details');
      if (f.canAddToCalendar) out.push('add_to_calendar');
      if (f.runningLateOpen) out.push('running_late');
      break;
    case 'today': case 'checkin_open':
      if (!f.startPassed && f.canMessage) out.push('arrived_early');
      if (f.runningLateOpen) out.push('running_late');
      if (phase === 'today') out.push('see_arrival_details');
      if (f.canAddToCalendar) out.push('add_to_calendar');
      break;
    case 'in_session': out.push('need_more_time'); break;
    case 'completed': if (f.canDownload) out.push('download_invoice'); break;
    case 'no_show': out.push('contact_local_cooks'); break;
    case 'cancelled': if (f.findAnotherTime) out.push('find_another_time'); break;
  }
  return out;
}

function managerSecondary(phase: BookingHeaderPhase, f: BookingNowFacts): NowSecondary[] {
  const out: NowSecondary[] = [];
  switch (phase) {
    case 'confirmed': case 'today': case 'checkin_open':
      out.push('extension_tools');
      if (phase === 'checkin_open' && f.startPassed) out.push('fix_record');
      if (f.managerCanManage) out.push('change_booking');
      if (f.canAddToCalendar) out.push('add_to_calendar');
      break;
    case 'in_session': out.push('extension_tools'); break;
    case 'time_ended_in_session': out.push('record_left'); break;
    case 'checkout_review':
      out.push('extension_tools');
      if (f.claimFilingOpen) out.push('report_damage');
      break;
    case 'visit_ended': out.push('fix_record'); break;
    case 'completed':
      if (f.claimFilingOpen) out.push('report_damage');
      out.push('extension_tools');
      if (f.canDownload) out.push('download_payout_statement');
      break;
    case 'no_show': out.push('fix_record'); break;
    case 'cancelled': if (f.managerCanManage) out.push('manage_refund'); break;
  }
  return out;
}

export function bookingNowContent({ phase, role, facts, t }: { phase: BookingHeaderPhase; role: NowRole; facts: BookingNowFacts; t: T }): BookingNowContent {
  const manager = role === 'manager';
  const primary = bookingPrimaryAction(phase, manager, !!facts.inspectionCanRespond);
  const visitPhases = !['pending', 'cancelled'].includes(phase);
  const attention: NowAttention[] = [];
  // Schedule changes are open only before the visit; extra time and claims once the booking is confirmed.
  if (['confirmed', 'today', 'checkin_open', 'cancellation_requested'].includes(phase)) attention.push('changes');
  if (visitPhases && phase !== 'cancellation_requested') attention.push('extensions');
  if (['checkout_review', 'visit_ended', 'completed', 'issue', 'no_show', 'time_ended_in_session'].includes(phase)) attention.push('claims');
  const body: NowBody = manager
    ? (BEFORE_START.includes(phase) ? 'code' : null)
    : BEFORE_START.includes(phase) ? 'preparation' : phase === 'no_show' ? 'no_show_message' : null;
  return {
    pill: { key: pillKey(phase, role, facts.cancelCause), tone: bookingPillTone(phase) },
    sentence: tidy(manager ? managerSentence(phase, facts, t) : chefSentence(phase, facts, t)),
    primary,
    payMayBePrimary: !manager && !primary && ['completed', 'issue', 'checkout_review', 'visit_ended', 'no_show'].includes(phase),
    secondary: manager ? managerSecondary(phase, facts) : chefSecondary(phase, facts),
    attention,
    body,
  };
}

/** The Now card shows at most three secondary links; the rest join the ⋯ menu (restraint budget §7). */
export const NOW_SECONDARY_VISIBLE = 3;
