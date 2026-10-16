import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ChevronRight, Mail, Phone } from 'lucide-react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { RevokeLocationAccessDialog } from '@/components/manager/applications/components/RevokeLocationAccessDialog';
import { DocumentViewerDialog } from '@/components/manager/applications/components/DocumentViewerDialog';
import { CustomerNotes } from './CustomerNotes';
import type { BookingOutcomeCode, ClaimActor, CustomerDocument, CustomerPageData, PageBooking, PastBooking } from './customer-types';
import {
  customerHref, documentLabel, formatCalendarDay, formatDay, formatMoment, formatMoney, formatVisit, nextActionText, statusLabelKey, statusVariant,
  targetHref, targetLabelKey,
} from './customer-format';
import { CustomersRequestError, resolveConversationId, useCustomerPage, useCustomerUnread, useRevokeCustomerAccess } from './use-customers';

const UPCOMING_SHOWN = 10;

const outcomeKey: Record<BookingOutcomeCode, string> = {
  completed_cleared: 'cuOutcomeCompletedCleared', completed: 'cuOutcomeCompleted', claim_filed: 'cuOutcomeClaimFiled', attendance_reported: 'cuOutcomeAttendance',
  cancelled_by_customer: 'cuOutcomeCancelledByCustomer', cancelled_by_you: 'cuOutcomeCancelledByYou', cancelled: 'cuOutcomeCancelled',
  visit_ended: 'cuOutcomeVisitEnded', request_unanswered: 'cuOutcomeUnanswered', cancellation_requested: 'cuOutcomeCancelRequested',
};
const claimStatusKey: Record<string, string> = {
  draft: 'cuClaimStatusDraft', awaiting_kitchen: 'cuClaimStatusAwaitingKitchen', in_review: 'cuClaimStatusInReview', submitted: 'cuClaimStatusSubmitted',
  chef_accepted: 'cuClaimStatusChefAccepted', chef_disputed: 'cuClaimStatusChefDisputed', under_review: 'cuClaimStatusUnderReview', approved: 'cuClaimStatusApproved',
  partially_approved: 'cuClaimStatusPartiallyApproved', rejected: 'cuClaimStatusRejected', charge_pending: 'cuClaimStatusChargePending',
  charge_succeeded: 'cuClaimStatusChargeSucceeded', charge_failed: 'cuClaimStatusChargeFailed', escalated: 'cuClaimStatusEscalated', resolved: 'cuClaimStatusResolved',
  expired: 'cuClaimStatusExpired',
};
const claimActorKey: Record<ClaimActor, string> = { you: 'cuClaimActorYou', customer: 'cuClaimActorCustomer', local_cooks: 'cuClaimActorLocalCooks', nobody: 'cuClaimActorNobody' };
const tourStatusKey: Record<string, string> = {
  pending: 'cuTourStatusPending', pending_local_cooks: 'cuTourStatusPending', confirmed: 'cuTourStatusConfirmed', completed: 'cuTourStatusCompleted',
  cancelled: 'cuTourStatusCancelled', no_show: 'cuTourStatusNoShow',
};

function Section({ id, title, children, className }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <Card role="region" aria-labelledby={id} className={className}>
      <CardHeader className="pb-3"><h2 id={id} className="text-base font-semibold leading-none tracking-tight">{title}</h2></CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export function CustomerPageView({ chefId, locationParam }: { chefId: number; locationParam: number | undefined }) {
  const locale = i18n.language || 'en-CA';
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [allUpcoming, setAllUpcoming] = useState(false);
  const [allPast, setAllPast] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [viewing, setViewing] = useState<CustomerDocument | null>(null);
  const [messageNote, setMessageNote] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const query = useCustomerPage(chefId, locationParam, allPast);
  const revoke = useRevokeCustomerAccess();
  const unread = useCustomerUnread(query.isSuccess);
  const data = query.data;

  if (query.isPending) return <div role="status" aria-label={mt('cuPageLoading')} className="space-y-4"><Skeleton className="h-32 w-full rounded-xl" /><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>;
  if (query.isError || !data) {
    const missing = query.error instanceof CustomersRequestError && query.error.status === 404;
    return (
      <div role="alert" className="space-y-3 rounded-xl border p-6">
        <p className="font-medium">{missing ? mt('cuPageNotFound') : mt('cuPageError')}</p>
        {missing && <p className="text-sm text-muted-foreground">{mt('cuPageNotFoundHelp')}</p>}
        <div className="flex flex-wrap gap-2">
          {!missing && <Button variant="outline" className="min-h-11" onClick={() => void query.refetch()}>{mt('cuTryAgain')}</Button>}
          <Button asChild variant="outline" className="min-h-11"><Link href="/manager/dashboard?view=customers">{mt('cuBackToCustomers')}</Link></Button>
        </div>
      </div>
    );
  }

  const { customer, location, next } = data;
  const timezone = location.timezone;
  const href = targetHref(next.target);
  const unreadCount = unread.data?.get(`${customer.chefId}:${location.id}`) ?? 0;
  const owner = next.owner === 'you' ? mt('cuTurnYou') : next.owner === 'customer' ? mt('cuTurnCustomer', { name: customer.name })
    : next.owner === 'local_cooks' ? mt('cuTurnLocalCooks') : mt('cuTurnNobody');
  const upcoming = allUpcoming ? data.upcoming : data.upcoming.slice(0, UPCOMING_SHOWN);

  const openConversation = async () => {
    setMessageNote(''); setMessageBusy(true);
    try {
      const id = await resolveConversationId(customer.chefId, location.id);
      if (!id) setMessageNote(mt('cuMessageUnavailable', { name: customer.name }));
      else navigate(`/manager/dashboard?view=messages&conversation=${encodeURIComponent(id)}&locationId=${location.id}`);
    } catch { setMessageNote(mt('cuMessageError')); } finally { setMessageBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Link href="/manager/dashboard?view=customers" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ArrowLeft className="h-4 w-4" aria-hidden />{mt('cuBackToCustomers')}
      </Link>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="space-y-1">
            <h1 className="break-words text-2xl font-semibold tracking-tight">{customer.name}</h1>
            {customer.businessName && <p className="text-muted-foreground">{customer.businessName}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {customer.email && <a className="inline-flex items-center gap-1.5 break-all hover:underline" href={`mailto:${customer.email}`}><Mail className="h-4 w-4 shrink-0" aria-hidden />{customer.email}</a>}
              {customer.phone && <a className="inline-flex items-center gap-1.5 hover:underline" href={`tel:${customer.phone}`}><Phone className="h-4 w-4 shrink-0" aria-hidden />{customer.phone}</a>}
              {customer.customerSince ? <span>{mt('cuCustomerSince', { date: formatDay(customer.customerSince, timezone, locale) })}</span>
                : customer.firstContactAt ? <span>{mt('cuFirstContact', { date: formatDay(customer.firstContactAt, timezone, locale) })}</span> : null}
            </div>
          </div>

          {data.locations.length > 1 ? (
            <div role="group" aria-label={mt('cuLocationSwitch')} className="flex flex-wrap gap-2">
              {data.locations.map(item => (
                <button key={item.id} type="button" aria-pressed={item.id === location.id} onClick={() => item.id !== location.id && navigate(customerHref(customer.chefId, item.id))}
                  className={cn('inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    item.id === location.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
                  {mt('cuAccessChip', { status: mt(statusLabelKey[item.status]), location: item.name })}
                </button>
              ))}
            </div>
          ) : (
            <div><Badge variant={statusVariant[data.status]}>{mt('cuAccessChip', { status: mt(statusLabelKey[data.status]), location: location.name })}</Badge></div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => void openConversation()} disabled={messageBusy}>{mt('cuActionMessage')}</Button>
            {data.actions.canInvite && (
              <Button asChild variant="outline" className="min-h-11"><Link href={`/manager/invitations/new?chefId=${customer.chefId}&locationId=${location.id}`}>{mt('cuActionInvite')}</Link></Button>
            )}
            {data.actions.canReview && data.actions.applicationId && (
              <Button asChild variant="outline" className="min-h-11"><Link href={`/manager/dashboard?view=applications&application=${data.actions.applicationId}`}>{mt('cuActionReview')}</Link></Button>
            )}
            {data.actions.canRevoke && (
              <Button variant="outline" className="min-h-11 border-destructive/30 text-destructive hover:bg-destructive/5" onClick={() => setRevoking(true)}>{mt('cuActionRevoke')}</Button>
            )}
          </div>
          {messageNote && <p role="alert" className="text-sm text-muted-foreground">{messageNote}</p>}
          {data.actions.revokedNote && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              {mt('cuRevokedNote', { location: location.name })}{' '}
              <a className="font-medium underline" href={`mailto:support@localcooks.ca?subject=${encodeURIComponent(`${customer.name} · ${location.name}`)}`}>{mt('cuContactLocalCooks')}</a>
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0 space-y-4">
          <Section id="cu-next" title={mt('cuNextCardTitle')}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={next.owner === 'you' ? 'warning' : 'outline'}>{owner}</Badge>
            </div>
            <p className="text-base font-medium">{nextActionText(mt, next, data.upcoming[0] && next.code === 'next_booking' ? { startsAt: data.upcoming[0].startsAt ?? '', endsAt: data.upcoming[0].endsAt ?? '', timezone } : null, timezone, locale)}</p>
            {next.deadlineAt && <p className="text-sm text-muted-foreground">{mt('cuDeadlineLabel', { when: formatMoment(next.deadlineAt, timezone, locale) })}</p>}
            {href && next.target && (next.owner === 'you' || ['next_booking', 'payment_recovery', 'problem'].includes(next.code))
              ? <Button asChild className="min-h-11"><Link href={href}>{mt(targetLabelKey[next.target.kind])}</Link></Button> : null}
          </Section>

          <Section id="cu-upcoming" title={mt('cuSecUpcoming')}>
            {data.upcoming.length === 0 ? <p className="text-sm text-muted-foreground">{mt('cuNoUpcoming')}</p> : (
              <ul className="space-y-2">{upcoming.map(booking => <UpcomingRow key={booking.bookingId} booking={booking} timezone={timezone} locale={locale} />)}</ul>
            )}
            {data.upcoming.length > UPCOMING_SHOWN && (
              <Button variant="outline" className="min-h-11" onClick={() => setAllUpcoming(value => !value)} aria-expanded={allUpcoming}>
                {allUpcoming ? mt('cuShowFewer') : mt('cuShowAll', { count: data.upcoming.length })}
              </Button>
            )}
          </Section>

          <Section id="cu-past" title={mt('cuSecPast')}>
            {data.past.length === 0 ? <p className="text-sm text-muted-foreground">{mt('cuNoPast')}</p> : (
              <ul className="space-y-2">{data.past.map(booking => <PastRow key={booking.bookingId} booking={booking} name={customer.name} timezone={timezone} locale={locale} />)}</ul>
            )}
            {data.pastHasMore && <Button variant="outline" className="min-h-11" onClick={() => setAllPast(true)}>{mt('cuShowMorePast')}</Button>}
          </Section>

          <Section id="cu-application" title={mt('cuSecApplication')}>
            {!data.application ? <p className="text-sm text-muted-foreground">{mt('cuNoApplication')}</p> : (
              <>
                <ol className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {data.application.stages.map(stage => (
                    <li key={stage.key} className={stage.at ? 'font-medium' : 'text-muted-foreground'}>
                      {stage.at ? mt('cuStageDate', { stage: mt(stageKey[stage.key]), date: formatDay(stage.at, timezone, locale) }) : mt(stageKey[stage.key])}
                    </li>
                  ))}
                </ol>
                <ul className="space-y-2">
                  {data.application.documents.map(document => <DocumentRow key={document.key} document={document} locale={locale} onView={() => setViewing(document)} />)}
                </ul>
              </>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Section id="cu-money" title={mt('cuSecMoney', { location: location.name })}>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {([['cuMoneyPaid', data.money.paidCents], ['cuMoneyRefunded', data.money.refundedCents], ['cuMoneyHeld', data.money.heldCents], ['cuMoneyOutstanding', data.money.outstandingCents]] as const).map(([label, cents]) => (
                <div key={label}><dt className="text-muted-foreground">{mt(label)}</dt><dd className="text-base font-semibold tabular-nums">{formatMoney(cents, locale, data.money.currency)}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">{mt('cuMoneyNote')}</p>
          </Section>

          <Section id="cu-claims" title={mt('cuSecClaims')}>
            {data.claims.length === 0 ? <p className="text-sm text-muted-foreground">{mt('cuNoClaims')}</p> : (
              <ul className="space-y-2">
                {data.claims.map(claim => (
                  <li key={claim.id} className="space-y-1 rounded-lg border p-3 text-sm">
                    <p className="font-medium">{claim.title}</p>
                    <p>{mt(claimStatusKey[claim.status] ?? 'cuClaimStatusUnderReview', { name: customer.name })}{claim.amountCents != null ? ` · ${formatMoney(claim.amountCents, locale)}` : ''}</p>
                    {claim.nextActor !== 'nobody' && <p className="text-muted-foreground">{mt('cuClaimNext', { actor: mt(claimActorKey[claim.nextActor], { name: customer.name }) })}{claim.deadlineAt ? ` · ${mt('cuDeadlineLabel', { when: formatMoment(claim.deadlineAt, timezone, locale) })}` : ''}</p>}
                    <Link className="inline-flex min-h-11 items-center font-medium underline sm:min-h-0" href={`/manager/dashboard?view=damage-claims&claim=${claim.id}`}>{mt('cuOpenClaim')}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="cu-messages" title={mt('cuSecMessages')}>
            <p className="text-sm">{mt('cuMessagesHelp', { name: customer.name })}</p>
            {unreadCount > 0 && <p className="text-sm font-medium">{mt('cuUnreadMessages', { count: unreadCount })}</p>}
            <Button variant="outline" className="min-h-11" onClick={() => void openConversation()} disabled={messageBusy}>{mt('cuOpenConversation')}</Button>
          </Section>

          <Section id="cu-tours" title={mt('cuSecTours')}>
            {data.tours.length === 0 ? <p className="text-sm text-muted-foreground">{mt('cuNoTours')}</p> : (
              <ul className="space-y-2">
                {data.tours.map(tour => (
                  <li key={tour.id}>
                    <Link href={`/manager/tours/${tour.id}`} className="block min-h-11 rounded-lg border p-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="block font-medium">{formatMoment(tour.scheduledAt, timezone, locale)}</span>
                      <span className="block text-muted-foreground">{[tour.kitchenName, mt(tourStatusKey[tour.status] ?? 'cuTourStatusPending')].filter(Boolean).join(' · ')}</span>
                      {tour.feedbackSubmitted && <span className="block text-muted-foreground">{mt('cuTourFeedbackShared')}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="cu-notes" title={mt('cuSecNotes')} className="order-last lg:order-first">
            <CustomerNotes chefId={customer.chefId} locationId={location.id} name={customer.name} timezone={timezone} />
          </Section>
        </div>
      </div>

      {revoking && (
        <RevokeLocationAccessDialog customer={{ chefId: customer.chefId, locationId: location.id, fullName: customer.name, location: { name: location.name } }}
          pending={revoke.isPending} onClose={() => setRevoking(false)}
          onConfirm={async reason => {
            await revoke.mutateAsync({ chefId: customer.chefId, locationId: location.id, reason });
            setRevoking(false);
            toast({ title: mt('cuRevokeDone', { location: location.name, name: customer.name }) });
          }} />
      )}
      {data.application && (
        <DocumentViewerDialog applicationId={data.application.id} open={viewing !== null} onOpenChange={open => { if (!open) setViewing(null); }}
          title={viewing ? documentLabel(mt, viewing.key === 'foodEstablishmentCert' ? 'foodEstablishmentCert' : 'foodSafetyLicense') : ''}
          url={viewing?.url} status={viewing?.status as 'pending' | 'approved' | 'rejected' | undefined} expiry={viewing?.expiry}
          labels={{ verified: mt('verified'), pending: mt('pending'), rejected: mt('rejected'), needsReplacement: mt('needsAReplacement'), expired: mt('licenseExpired'),
            verify: mt('verifyDocument'), openInNewTab: mt('openInNewTab'), close: mt('close'), loading: mt('loadingDocument'), loadFailed: mt('documentUnavailable'),
            expires: mt('expiresLabel', { date: '{date}' }), working: mt('saving') }} />
      )}
    </div>
  );
}

const stageKey = { requested: 'cuStageRequested', localCooksApproved: 'cuStageLocalCooks', documentsSubmitted: 'cuStageDocuments', youApproved: 'cuStageYou' } as const;

function UpcomingRow({ booking, timezone, locale }: { booking: PageBooking; timezone: string; locale: string }) {
  const label = booking.status === 'confirmed' ? mt('cuBookingConfirmed') : booking.status === 'cancellation_requested' ? mt('cuBookingCancelRequested') : mt('cuBookingRequested');
  const addOns = booking.equipmentCount + booking.storageCount;
  return (
    <li>
      <Link href={`/manager/booking/${booking.bookingId}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 space-y-0.5">
          <span className="block font-medium">{formatVisit(booking.startsAt, booking.endsAt, timezone, locale) || mt('cuBookingTimeUnknown')}</span>
          <span className="block text-muted-foreground">
            {[booking.kitchenName, label, booking.status === 'pending' && booking.responseDeadlineAt ? mt('cuRespondBy', { when: formatMoment(booking.responseDeadlineAt, timezone, locale) }) : null,
              addOns > 0 ? mt('cuAddOns', { count: addOns }) : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

function PastRow({ booking, name, timezone, locale }: { booking: PastBooking; name: string; timezone: string; locale: string }) {
  const outcome = booking.outcome === 'cancelled_by_customer' && booking.refundedCents > 0
    ? mt('cuOutcomeCancelledByCustomerRefund', { name, amount: formatMoney(booking.refundedCents, locale) })
    : mt(outcomeKey[booking.outcome], { name });
  return (
    <li>
      <Link href={`/manager/booking/${booking.bookingId}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg border p-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0 space-y-0.5">
          <span className="block font-medium">{formatVisit(booking.startsAt, booking.endsAt, timezone, locale) || mt('cuBookingTimeUnknown')}</span>
          <span className="block text-muted-foreground">{booking.kitchenName} · {outcome}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </li>
  );
}

function DocumentRow({ document, locale, onView }: { document: CustomerDocument; locale: string; onView: () => void }) {
  const label = documentLabel(mt, document.key);
  const expired = document.daysLeft !== null && document.daysLeft <= 0;
  const status = !document.uploaded ? mt('cuDocNotUploaded') : expired ? mt('cuDocExpiredStatus')
    : document.status === 'approved' ? mt('cuDocVerified') : document.status === 'rejected' ? mt('cuDocRejected') : mt('cuDocPending');
  const tone = document.stage === 'expired' || document.stage === '7_day' ? 'text-red-700 dark:text-red-400' : document.stage === '30_day' ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground';
  const expiry = !document.expiry ? mt('cuDocNoExpiry')
    : expired ? mt('cuDocExpiredOn', { date: formatCalendarDay(document.expiry, locale) })
    : document.stage ? `${mt('cuDocExpiresOn', { date: formatCalendarDay(document.expiry, locale) })} · ${mt('cuDocExpiresInDays', { days: document.daysLeft ?? 0 })}`
    : mt('cuDocExpiresOn', { date: formatCalendarDay(document.expiry, locale) });
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{label}</p>
        <p>{status}</p>
        <p className={cn(document.stage && 'font-medium', tone)} data-expiry-stage={document.stage ?? 'ok'}>{expiry}</p>
        {document.renewalPending && <p className="text-muted-foreground">{mt('cuRenewalPending')}</p>}
      </div>
      {document.url && <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" aria-label={mt('cuViewFileFor', { document: label })} onClick={onView}>{mt('cuViewFile')}</Button>}
    </li>
  );
}

export default CustomerPageView;
