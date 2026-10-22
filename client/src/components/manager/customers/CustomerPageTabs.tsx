import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { ChevronRight } from 'lucide-react';
import { mt } from '@/i18n/manager';
import { cn } from '@/lib/utils';
import { badge, btnSecondary, card, cardBody, cardHead, cardMeta, cardTitle, focusRing, groupCount, groupLabel, linkTertiary, sub } from '@/components/dashboard/dashboard-ui';
import type { ActivityItem, CustomerPageData, OpenItem, PageBooking, PastBooking, PaymentRow, Rental, StorageRow } from './customer-types';
import { dateSpan, formatDay, formatMoney, nextActionText, relativeDay, shortMoment, clockOf, targetHref, targetLabelKey, visitLine } from './customer-format';

export type TabKey = 'overview' | 'bookings' | 'storage' | 'money' | 'docs' | 'activity';
type TabProps = { data: CustomerPageData; locale: string };
const PAGE = 10;
const rule = 'border-[#f0eeec]';

/** Meta facts joined by " · ", wrapping only between facts. */
export function Facts({ items }: { items: ReactNode[] }) {
  const list = items.filter(item => item !== null && item !== undefined && item !== false && item !== '');
  return <>{list.map((item, index) => <span key={index}><span className="inline-block">{item}{index < list.length - 1 && ' ·'}</span>{index < list.length - 1 && ' '}</span>)}</>;
}
/** A visit over several days breaks only at its en dash. */
function When({ text }: { text: string }) {
  const parts = text.split(' – ');
  return <>{parts.map((part, index) => <span key={index}>{index > 0 && ' – '}<span className="whitespace-nowrap">{part}</span></span>)}</>;
}
const rentalsShort = (rentals: Rental[] | undefined) => rentals?.length ? mt('cpRentals', { count: rentals.length }) : null;
const rentalsLong = (rentals: Rental[] | undefined) => rentals?.length
  ? mt('cpRentalsDetail', { count: rentals.length, list: rentals.map(rental => mt('cpRentalDays', { name: rental.name, days: rental.days })).join('; ') }) : null;

function Card({ id, title, count, action, children, wrap }: { id: string; title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; wrap?: boolean }) {
  return (
    <section className={card} aria-labelledby={id}>
      <div className={cn(cardHead, wrap && 'flex-wrap gap-y-2.5 pb-1 sm:flex-nowrap sm:pb-0')}>
        <h2 id={id} className={cn(cardTitle, 'min-w-0 truncate')}>{title}{count !== undefined && count !== '' && count !== 0 && <span className={cardMeta}>{count}</span>}</h2>
        {action}
      </div>
      <div className={cardBody}>{children}</div>
    </section>
  );
}
function Empty({ title, text, action, tight }: { title: string; text: string; action?: ReactNode; tight?: boolean }) {
  return (
    <div className={tight ? 'pb-0.5 pt-1.5 text-left' : 'pb-2 pt-5 text-center'}>
      <p className="font-medium text-stone-900">{title}</p>
      <p className={cn('mt-0.5 text-[13px] leading-[18px] text-stone-600', tight ? 'text-pretty' : 'mx-auto max-w-[46ch] text-balance')}>{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
const TertiaryLink = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className={cn(linkTertiary, 'whitespace-nowrap')}>{children}<ChevronRight className="size-3.5" aria-hidden /></Link>;
const TertiaryButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => <button type="button" onClick={onClick} className={cn(linkTertiary, 'whitespace-nowrap')}>{children}<ChevronRight className="size-3.5" aria-hidden /></button>;
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string; count?: number }[]; onChange: (key: T) => void }) {
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-stone-100 p-0.5 ring-1 ring-inset ring-stone-200">
      {options.map(option => (
        <button key={option.key} type="button" aria-pressed={option.key === value} onClick={() => onChange(option.key)}
          className={cn('h-7 whitespace-nowrap rounded-md px-2.5 text-[13px] text-stone-600 hover:text-stone-900', focusRing,
            option.key === value && 'bg-white font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.08),0_0_0_1px_rgba(28,25,23,.06)]')}>
          {option.label}{option.count !== undefined && <span className="ml-1 text-stone-500">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ───────────── Overview ───────────── */

export function OverviewTab({ data, locale, go, inviteHref }: TabProps & { go: (tab: TabKey) => void; inviteHref: string }) {
  const tz = data.location.timezone, name = data.customer.name;
  const yours = data.open.filter(item => item.owner === 'you'), others = data.open.filter(item => item.owner !== 'you');
  const now = Date.now();
  const live = data.upcoming.filter(booking => booking.startsAt && Date.parse(booking.startsAt) <= now);
  const next = data.upcoming.filter(booking => !booking.startsAt || Date.parse(booking.startsAt) > now);
  const group = (label: string, items: ReactNode[], first: boolean) => (
    <div key={label}>
      <div className={cn(groupLabel, 'mb-0.5 flex items-baseline', first ? 'mt-1.5' : 'mt-3')}>{label}<span className={groupCount}>{items.length}</span></div>
      <ul>{items}</ul>
    </div>
  );
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Card id="cp-open" title={mt('cpOpenWith', { name })} count={data.open.length ? <Facts items={[data.open.length, mt('cpForYouCount', { count: yours.length })]} /> : undefined}>
        {data.open.length ? <>
          {yours.length > 0 && group(mt('cpForYou'), yours.map((item, index) => <OpenRow key={index} item={item} data={data} locale={locale} go={go} />), true)}
          {others.length > 0 && group(mt('cpWaitingOnOthers'), others.map((item, index) => <OpenRow key={index} item={item} data={data} locale={locale} go={go} />), !yours.length)}
        </> : <Empty tight title={mt('cpNothingOpen')} text={mt('cpNothingOpenText')} />}
      </Card>

      <Card id="cp-coming" title={mt('cpComingUp')} count={data.upcoming.length ? mt('cpBookingCount', { count: data.upcoming.length }) : undefined}
        action={data.upcoming.length ? <TertiaryButton onClick={() => go('bookings')}>{mt('cpViewAll')}</TertiaryButton> : undefined}>
        {data.upcoming.length ? <>
          {live.length > 0 && <div><div className={cn(groupLabel, 'mb-0.5 mt-1.5 flex items-baseline')}>{mt('cpInProgress')}<span className={groupCount}>{live.length}</span></div>
            <div>{live.map(booking => <VisitRow key={booking.bookingId} booking={booking} tz={tz} locale={locale} />)}</div></div>}
          {next.length > 0 && <div><div className={cn(groupLabel, 'mb-0.5 flex items-baseline', live.length ? 'mt-3' : 'mt-1.5')}>{mt('cpNext')}<span className={groupCount}>{next.length}</span></div>
            <div>{next.slice(0, 4).map(booking => <VisitRow key={booking.bookingId} booking={booking} tz={tz} locale={locale} />)}</div></div>}
        </> : <Empty title={mt('cpNoBookingsYet')} text={mt('cpNoBookingsYetText', { name, location: data.location.name })}
          action={data.actions.canInvite ? <Link href={inviteHref} className={btnSecondary}>{mt('cuActionInvite')}</Link> : undefined} />}
      </Card>

      <Card id="cp-recent" title={mt('cpRecentActivity')} action={data.activity.length ? <TertiaryButton onClick={() => go('activity')}>{mt('cpViewAll')}</TertiaryButton> : undefined}>
        {data.activity.length ? <ul>{data.activity.slice(0, 6).map((item, index) => <FeedItem key={index} item={item} data={data} locale={locale} />)}</ul>
          : <Empty tight title={mt('cpNoActivity')} text={mt('cpNoActivityText', { name })} />}
      </Card>
    </div>
  );
}

function VisitRow({ booking, tz, locale }: { booking: PageBooking; tz: string; locale: string }) {
  return (
    <Link href={`/manager/booking/${booking.bookingId}`} className={cn('-mx-2 grid grid-cols-[minmax(0,1fr)_16px] items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-stone-50 [&+&]:rounded-t-none [&+&]:border-t', rule, focusRing)}>
      <span className="min-w-0">
        <span className="block font-medium text-stone-900"><When text={visitLine(mt, booking.startsAt, booking.endsAt, tz, locale) || mt('cuBookingTimeUnknown')} /></span>
        <span className={cn(sub, 'mt-px block')}><Facts items={[booking.kitchenName, booking.status === 'pending' ? mt('cuBookingRequested') : null, rentalsShort(booking.rentals), booking.reference]} /></span>
      </span>
      <ChevronRight className="size-4 text-stone-400" aria-hidden />
    </Link>
  );
}

function OpenRow({ item, data, locale, go }: { item: OpenItem; data: CustomerPageData; locale: string; go: (tab: TabKey) => void }) {
  const tz = data.location.timezone, name = data.customer.name;
  const visit = visitLine(mt, item.startsAt, item.endsAt, tz, locale, new Date(), true);
  const bookingLink = item.bookingId ? <TertiaryLink href={`/manager/booking/${item.bookingId}`}>{mt('cuOpenBooking')}</TertiaryLink> : null;
  let title: ReactNode, text: ReactNode = null, action: ReactNode = bookingLink;
  switch (item.kind) {
    case 'storage_move_in': {
      const days = item.startOn ? Math.max(0, Math.round((Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())}T00:00:00Z`) - Date.parse(`${item.startOn}T00:00:00Z`)) / 86_400_000)) : 0;
      title = <Facts items={[item.name, mt('cpMoveInNotConfirmed')]} />;
      text = <Facts items={[mt('cpRentalDates', { dates: dateSpan(item.startOn, item.endOn, locale) }), <span className="font-medium text-amber-800">{mt('cpStartedDaysAgo', { count: days })}</span>]} />;
      action = <Link href={`/manager/storage/${item.storageId}`} className={btnSecondary}>{mt('cpConfirmMoveIn')}</Link>;
      break;
    }
    case 'booking_request':
      title = <Facts items={[mt('cpBookingRequest'), <When text={visit} />]} />;
      text = item.deadlineAt ? mt('cuRespondBy', { when: shortMoment(item.deadlineAt, tz, locale) }) : null;
      action = item.bookingId ? <Link href={`/manager/booking/${item.bookingId}`} className={btnSecondary}>{mt('cpRespond')}</Link> : null;
      break;
    case 'cancellation_request':
      title = <Facts items={[mt('cpCancellationRequest'), <When text={visit} />]} />;
      text = mt('cpAskedToCancel', { name });
      action = item.bookingId ? <Link href={`/manager/booking/${item.bookingId}`} className={btnSecondary}>{mt('cpDecide')}</Link> : null;
      break;
    case 'next': {
      const href = targetHref(data.next.target);
      title = nextActionText(mt, data.next, null, tz, locale);
      text = data.next.deadlineAt ? mt('cuRespondBy', { when: shortMoment(data.next.deadlineAt, tz, locale) }) : null;
      action = href && data.next.target ? <Link href={href} className={btnSecondary}>{mt(targetLabelKey[data.next.target.kind])}</Link> : null;
      break;
    }
    case 'no_show_review':
      title = <Facts items={[mt('cpNoShowDisputed'), <When text={visit} />]} />;
      text = mt('cpNoShowDisputedText', { name });
      break;
    case 'problem':
      title = <Facts items={[mt('cpProblemReported'), visit ? <When text={visit} /> : null]} />;
      text = item.owner === 'you' ? mt('cpProblemYou') : mt('cpProblemLocalCooks');
      break;
    case 'claims':
      title = <Facts items={[mt(item.owner === 'local_cooks' ? 'cpClaimsInReview' : item.owner === 'customer' ? 'cpClaimsWaiting' : 'cpClaimsToFinish', { count: item.count ?? 0, name }),
        formatMoney(item.amountCents ?? 0, locale, data.money.currency)]} />;
      text = mt(item.owner === 'local_cooks' ? 'cpClaimsInReviewText' : item.owner === 'customer' ? 'cpClaimsWaitingText' : 'cpClaimsToFinishText',
        { name, references: (item.references ?? []).join(', ') });
      action = <TertiaryButton onClick={() => go('money')}>{mt('cpViewClaims')}</TertiaryButton>;
      break;
  }
  return (
    <li className={cn('grid grid-cols-1 items-center gap-2.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 [&+&]:border-t', rule)}>
      <div className="min-w-0">
        <div className="font-medium text-stone-900">{title}</div>
        {text && <div className={cn(sub, 'mt-0.5')}>{text}</div>}
      </div>
      {action && <div className="flex items-center justify-start gap-2 sm:justify-end [&>a.inline-flex]:h-10 sm:[&>a.inline-flex]:h-8">{action}</div>}
    </li>
  );
}

/* ───────────── Activity ───────────── */

function activityText(item: ActivityItem, data: CustomerPageData, locale: string): { title: string; facts: ReactNode[]; tone: 'you' | 'money' | 'warn' | 'plain' } {
  const tz = data.location.timezone, name = data.customer.name, currency = data.money.currency;
  const visit = visitLine(mt, item.startsAt, item.endsAt, tz, locale);
  const money = (cents?: number) => formatMoney(cents ?? 0, locale, currency);
  switch (item.type) {
    case 'booked': return { title: mt('cpActBooked', { when: visit }), facts: [mt('cpPaid', { amount: money(item.amountCents) }), rentalsLong(item.rentals), item.reference], tone: 'money' };
    case 'requested': return { title: mt('cpActRequested', { when: visit }), facts: [rentalsLong(item.rentals), item.reference], tone: 'plain' };
    case 'cancelled': return { title: mt(item.actor === 'you' ? 'cpActYouCancelled' : item.actor === 'customer' ? 'cpActTheyCancelled' : 'cpActCancelled'),
      facts: [<When text={visit} />, item.refundedCents ? mt('cpRefunded', { amount: money(item.refundedCents) }) : null, item.reference], tone: item.actor === 'you' ? 'you' : item.refundedCents ? 'money' : 'plain' };
    case 'rental_day_cancelled': return { title: mt(item.actor === 'you' ? 'cpActYouCancelledRentalDay' : 'cpActTheyCancelledRentalDay'),
      facts: [item.date ? mt('cpItemOnDay', { name: item.name, day: relativeDay(mt, `${item.date}T15:00:00Z`, 'UTC', locale) }) : item.name, item.reference], tone: item.actor === 'you' ? 'you' : 'plain' };
    case 'visit_ended': return { title: mt('cpActVisitEnded'), facts: [<When text={visit} />, item.reference], tone: 'plain' };
    case 'no_show_reported': return { title: mt(item.actor === 'you' ? 'cpActYouReportedNoShow' : 'cpActLocalCooksNoShow'),
      facts: [<When text={visit} />, mt(item.status === 'under_review' ? 'cpDisputed' : 'cpNotDisputed'), item.reference], tone: 'warn' };
    case 'no_show_disputed': return { title: mt('cpActSaidThere'), facts: [<When text={visit} />, mt(item.status === 'resolved' ? 'cpLocalCooksResolved' : 'cpLocalCooksReviewing'), item.reference], tone: 'warn' };
    case 'claim_filed': return { title: mt('cpActYouFiledClaim'), facts: [item.name, money(item.amountCents), item.status ? claimStatus(item.status, name) : null, item.reference], tone: 'warn' };
    case 'storage_rented': return { title: mt('cpActRented', { name: item.name }), facts: [dateSpan(item.startOn, item.endOn, locale), money(item.amountCents), item.reference], tone: 'plain' };
    case 'applied': return { title: mt('cpActApplied'), facts: [data.location.name], tone: 'plain' };
    case 'local_cooks_approved': return { title: mt('cpActLocalCooksApproved'), facts: [], tone: 'plain' };
    case 'documents_sent': return { title: mt('cpActDocumentsSent'), facts: [], tone: 'plain' };
    case 'access_approved': return { title: mt('cpActYouApproved'), facts: [data.location.name], tone: 'you' };
  }
}
const dot = { you: 'bg-stone-900', money: 'bg-emerald-500', warn: 'bg-amber-500', plain: 'bg-stone-300' } as const;

function FeedItem({ item, data, locale, full }: { item: ActivityItem; data: CustomerPageData; locale: string; full?: boolean }) {
  const tz = data.location.timezone;
  const { title, facts, tone } = activityText(item, data, locale);
  const day = relativeDay(mt, item.at, tz, locale);
  const time = full || day === mt('cpToday') ? clockOf(item.at, tz, locale) : day;
  return (
    <li className="relative grid grid-cols-[12px_minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-[9px] [&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:-bottom-1.5 [&:not(:last-child)]:after:left-[3px] [&:not(:last-child)]:after:top-6 [&:not(:last-child)]:after:w-px [&:not(:last-child)]:after:bg-[#f0eeec]">
      <span aria-hidden className={cn('row-span-2 mt-1.5 size-[7px] rounded-full', dot[tone])} />
      <span className="min-w-0 font-medium text-stone-900">{title}</span>
      <time dateTime={item.at} className="col-start-3 row-start-1 whitespace-nowrap text-xs text-stone-500">{time}</time>
      {facts.some(Boolean) && <span className={cn(sub, 'col-start-2')}><Facts items={facts} /></span>}
    </li>
  );
}

export function ActivityTab({ data, locale }: TabProps) {
  const [category, setCategory] = useState<'all' | 'booking' | 'money' | 'access'>('all');
  const tz = data.location.timezone, name = data.customer.name;
  const list = data.activity.filter(item => category === 'all' || item.category === category);
  const days: { day: string; items: ActivityItem[] }[] = [];
  for (const item of list) {
    const day = relativeDay(mt, item.at, tz, locale);
    if (days.length && days[days.length - 1].day === day) days[days.length - 1].items.push(item); else days.push({ day, items: [item] });
  }
  const emptyKey = category === 'money' ? 'cpActivityEmptyMoney' : category === 'access' ? 'cpActivityEmptyAccess' : 'cpActivityEmptyBookings';
  return (
    <Card id="cp-activity" title={mt('cpTab_activity')} wrap action={
      <Segmented label={mt('cpShow')} value={category} onChange={setCategory} options={[
        { key: 'all', label: mt('cpFilterAll') }, { key: 'booking', label: mt('cpFilterBookings') }, { key: 'money', label: mt('cpFilterMoney') }, { key: 'access', label: mt('cpFilterAccess') }]} />}>
      {list.length ? <>
        {days.map(group => <div key={group.day}>
          <div className="pb-0.5 pt-2.5 text-xs font-semibold text-stone-500 first:pt-0">{group.day}</div>
          <ul>{group.items.map((item, index) => <FeedItem key={index} item={item} data={data} locale={locale} full />)}</ul>
        </div>)}
        <div className={cn('mt-1 flex items-center justify-between gap-3 border-t pt-3', rule)}><span className="text-xs text-stone-500">{mt('cpShowingOf', { shown: list.length, total: list.length })}</span></div>
      </> : <Empty title={mt('cpNothingHereYet')} text={mt(emptyKey, { name })} />}
    </Card>
  );
}

/* ───────────── Bookings ───────────── */

const claimStatusKey: Record<string, string> = {
  draft: 'cuClaimStatusDraft', awaiting_kitchen: 'cuClaimStatusAwaitingKitchen', in_review: 'cuClaimStatusInReview', submitted: 'cuClaimStatusSubmitted',
  chef_accepted: 'cuClaimStatusChefAccepted', chef_disputed: 'cuClaimStatusChefDisputed', under_review: 'cuClaimStatusUnderReview', approved: 'cuClaimStatusApproved',
  partially_approved: 'cuClaimStatusPartiallyApproved', rejected: 'cuClaimStatusRejected', charge_pending: 'cuClaimStatusChargePending',
  charge_succeeded: 'cpClaimPaidBy', charge_failed: 'cuClaimStatusChargeFailed', escalated: 'cuClaimStatusEscalated', resolved: 'cuClaimStatusResolved',
  expired: 'cuClaimStatusExpired',
};
const claimStatus = (status: string, name: string) => mt(claimStatusKey[status] ?? 'cuClaimStatusUnderReview', { name });

function bookingStatus(booking: PageBooking | PastBooking, name: string, locale: string, currency: string): [ReactNode, ReactNode] {
  const money = (cents: number) => formatMoney(cents, locale, currency);
  if (!('outcome' in booking)) {
    if (booking.startsAt && Date.parse(booking.startsAt) <= Date.now()) return [<span className={badge.brand}>{mt('cpInProgress')}</span>, null];
    if (booking.status === 'pending') return [mt('cuBookingRequested'), null];
    if (booking.status === 'cancellation_requested') return [<span className={badge.attention}>{mt('cuBookingCancelRequested')}</span>, null];
    return [mt('cuBookingConfirmed'), null];
  }
  switch (booking.outcome) {
    case 'cancelled_by_customer': return [<>{mt('cuOutcomeCancelledByCustomer', { name })}{booking.late && <span className={badge.attention}>{mt('cpLate')}</span>}</>,
      booking.late ? <Facts items={[mt('cpInsideWindow'), booking.refundedCents ? mt('cpRefunded', { amount: money(booking.refundedCents) }) : mt('cpNoRefund')]} />
        : booking.refundedCents ? mt('cpRefundedCap', { amount: money(booking.refundedCents) }) : null];
    case 'cancelled_by_you': return [mt('cuOutcomeCancelledByYou'), booking.refundedCents ? mt('cpRefundedCap', { amount: money(booking.refundedCents) }) : null];
    case 'cancelled': return [mt('cpDeclinedOrExpired'), null];
    case 'attendance_reported': return booking.noShow === 'under_review'
      ? [<span className={badge.neutral}>{mt('cpNoShowDisputed')}</span>, mt('cpLocalCooksReviewingCap')]
      : [<span className={badge.attention}>{mt('cpNoShow')}</span>, mt('cpNoShowCounted')];
    case 'claim_filed': return [<span className={badge.attention}>{mt('cuOutcomeClaimFiled')}</span>, null];
    case 'request_unanswered': return [mt('cpRequestNotAnswered'), null];
    case 'completed_cleared': return [mt('cuOutcomeCompleted'), mt('cpClearedByYou')];
    case 'completed': return [mt('cuOutcomeCompleted'), null];
    case 'cancellation_requested': return [mt('cuOutcomeCancelRequested'), null];
    default: return [mt('cpVisitEnded'), null];
  }
}

export function BookingsTab({ data, locale, inviteHref }: TabProps & { inviteHref: string }) {
  const [segment, setSegment] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const [all, setAll] = useState(false);
  const tz = data.location.timezone, name = data.customer.name;
  const isCancelled = (booking: PastBooking) => ['cancelled_by_customer', 'cancelled_by_you', 'cancelled'].includes(booking.outcome);
  const lists = { upcoming: data.upcoming as (PageBooking | PastBooking)[], past: data.past.filter(booking => !isCancelled(booking)), cancelled: data.past.filter(isCancelled) };
  const list = lists[segment], shown = all ? list : list.slice(0, PAGE);
  const total = data.bookingCounts[segment];
  const empty = { upcoming: ['cpNoUpcoming', 'cpNoUpcomingText'], past: ['cpNoPast', 'cpNoPastText'], cancelled: ['cpNoCancelled', 'cpNoCancelledText'] }[segment];
  return (
    <Card id="cp-bookings" title={mt('cpBookingsAt', { location: data.location.name })} wrap action={
      <Segmented label={mt('cpWhichBookings')} value={segment} onChange={key => { setSegment(key); setAll(false); }} options={[
        { key: 'upcoming', label: mt('cpSegUpcoming'), count: data.bookingCounts.upcoming }, { key: 'past', label: mt('cpSegPast'), count: data.bookingCounts.past },
        { key: 'cancelled', label: mt('cpSegCancelled'), count: data.bookingCounts.cancelled }]} />}>
      {!list.length ? <Empty title={mt(empty[0])} text={mt(empty[1], { name, location: data.location.name })}
        action={segment === 'upcoming' && data.actions.canInvite ? <Link href={inviteHref} className={btnSecondary}>{mt('cuActionInvite')}</Link> : undefined} /> : <>
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs font-medium text-stone-500">
            <th className="whitespace-nowrap pb-2 pr-3 font-medium">{mt('cpColWhen')}</th><th className="whitespace-nowrap pb-2 pr-3 font-medium">{mt('cpColStatus')}</th>
            <th className="hidden whitespace-nowrap pb-2 font-medium sm:table-cell">{mt('cpColReference')}</th></tr></thead>
          <tbody>{shown.map(booking => {
            const [label, detail] = bookingStatus(booking, name, locale, data.money.currency);
            return (
              <tr key={booking.bookingId} className={cn('border-t align-top hover:bg-stone-50', rule)}>
                <td className="py-2.5 pr-2 sm:pr-3">
                  <Link href={`/manager/booking/${booking.bookingId}`} className={cn('font-medium text-stone-900 hover:underline', focusRing)}><When text={visitLine(mt, booking.startsAt, booking.endsAt, tz, locale) || mt('cuBookingTimeUnknown')} /></Link>
                  <span className={cn(sub, 'block')}><Facts items={[booking.kitchenName, rentalsShort(booking.rentals)]} /><span className="sm:hidden">{booking.reference && <> · <span className="whitespace-nowrap">{booking.reference}</span></>}</span></span>
                </td>
                <td className="w-[38%] py-2.5 pr-0 sm:pr-3"><span className="flex flex-wrap items-center gap-1.5">{label}</span>{detail && <span className={cn(sub, 'block')}>{detail}</span>}</td>
                <td className="hidden whitespace-nowrap py-2.5 text-stone-500 sm:table-cell">{booking.reference ?? ''}</td>
              </tr>
            );
          })}</tbody>
        </table>
        <div className={cn('mt-1 flex items-center justify-between gap-3 border-t pt-3', rule)}>
          <span className="text-xs text-stone-500">{mt('cpShowingOf', { shown: shown.length, total })}</span>
          {!all && list.length > PAGE && <button type="button" className={btnSecondary} onClick={() => setAll(true)}>{mt('cpShowAll')}</button>}
        </div>
        {segment !== 'upcoming' && <p className="mt-3 text-pretty text-xs leading-4 text-stone-500">{mt('cpBookingsFootnote', { name })}</p>}
      </>}
    </Card>
  );
}

/* ───────────── Storage ───────────── */

function storageStatus(row: StorageRow): [string, 'attention' | 'negative' | 'neutral' | null] {
  switch (row.state) {
    case 'reserved': return row.moveInOverdue ? [mt('cpMoveInNotConfirmedCap'), 'attention'] : [mt('cpStorageBooked'), null];
    case 'requested': return [mt('cuBookingRequested'), null];
    case 'active': return [mt('cpStorageInUse'), null];
    case 'move_out_requested': return [mt('cpStorageMovingOut'), null];
    case 'removal_review': return [mt('cpStoragePastEnd'), 'negative'];
    case 'ended': return [row.endReason === 'claim' ? mt('cpStorageEndedClaim') : mt('cpStorageEnded'), null];
    case 'declined': return [mt('cpStorageDeclined'), null];
    case 'expired': return [mt('cpStorageExpired'), null];
    case 'withdrawn': return [mt('cpStorageWithdrawn'), null];
    default: return [row.state, null];
  }
}

export function StorageTab({ data, locale }: TabProps) {
  return (
    <Card id="cp-storage" title={mt('cpStorageRentals')} count={data.storage.length || undefined}>
      {data.storage.length ? (
        <table className="w-full border-collapse text-sm">
          <thead><tr className="text-left text-xs font-medium text-stone-500">
            <th className="pb-2 pr-3 font-medium">{mt('cpColSpace')}</th><th className="hidden pb-2 pr-3 font-medium sm:table-cell">{mt('cpColDates')}</th>
            <th className="pb-2 pr-3 font-medium">{mt('cpColStatus')}</th><th className="pb-2 text-right font-medium">{mt('cpColTotal')}</th></tr></thead>
          <tbody>{data.storage.map(row => {
            const [label, tone] = storageStatus(row);
            return (
              <tr key={row.id} className={cn('border-t align-top hover:bg-stone-50', rule)}>
                <td className="py-2.5 pr-3"><Link href={`/manager/storage/${row.id}`} className={cn('font-medium text-stone-900 hover:underline', focusRing)}>{row.name}</Link>
                  <span className={cn(sub, 'block')}><Facts items={[row.reference, <span className="sm:hidden">{dateSpan(row.startOn, row.endOn, locale)}</span>]} /></span></td>
                <td className="hidden whitespace-nowrap py-2.5 pr-3 sm:table-cell">{dateSpan(row.startOn, row.endOn, locale)}</td>
                <td className="py-2.5 pr-3">{tone ? <span className={badge[tone]}>{label}</span> : label}</td>
                <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{formatMoney(row.totalCents, locale, data.money.currency)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      ) : <Empty title={mt('cpNoStorage')} text={mt('cpNoStorageText', { name: data.customer.name })} />}
    </Card>
  );
}

/* ───────────── Money ───────────── */

function payoutLine(row: PaymentRow, tz: string, locale: string) {
  if (row.payoutCents == null) return row.status === 'authorized' ? mt('cpPayoutHeld') : '';
  switch (row.payoutStatus) {
    case 'sent': return row.payoutAt ? mt('cpPayoutSentOn', { date: formatDay(row.payoutAt, tz, locale) }) : mt('cpPayoutSent');
    case 'scheduled': return row.payoutAt ? mt('cpPayoutExpected', { date: formatDay(row.payoutAt, tz, locale) }) : mt('cpPayoutAfterCloseout');
    case 'on_hold': return mt('cpPayoutOnHold');
    default: return row.payoutCents > 0 ? mt('cpPayoutWithPayment') : mt('cpPayoutNone');
  }
}

export function MoneyTab({ data, locale }: TabProps) {
  const { money, location } = data, tz = location.timezone, name = data.customer.name;
  const cad = (cents: number) => formatMoney(cents, locale, money.currency);
  const empty = !money.paymentCount && !money.holdCount && !money.refundedCents;
  const summary: [string, number, string][] = [
    [mt('cuMoneyPaid'), money.paidCents, money.paymentCount ? mt('cpPaymentsCount', { count: money.paymentCount }) : mt('cpNoPaymentsYet')],
    [mt('cuMoneyRefunded'), money.refundedCents, money.refundedCents ? mt('cpFullAndPartRefunds') : mt('cpNoRefunds')],
    [mt('cuMoneyHeld'), money.heldCents, money.holdCount ? mt('cpRequestsCount', { count: money.holdCount }) : mt('cpNothingHeld')],
    [mt('cpOwedToYou'), money.outstandingCents, money.outstandingCents ? mt('cpUnpaidCharges') : mt('cpNoUnpaidCharges')],
    [mt('cpClaimsCollected'), money.claimsCollectedCents, money.claimsCollectedCount ? mt('cpClaimsPaid', { count: money.claimsCollectedCount }) : mt('cpNoClaimsPaid')],
  ];
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Card id="cp-money" title={mt('cuSecMoney', { location: location.name })} count={money.currency}>
        <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-5 sm:gap-y-0">
          {summary.map(([label, cents, caption], index) => (
            <div key={label} className={cn('min-w-0 pl-3 sm:px-4', index % 2 === 0 && 'border-l-0 pl-0 sm:pl-4', index > 0 && 'sm:border-l', index % 2 === 1 && 'border-l', rule,
              index === 0 && 'sm:pl-0', index === 4 && 'col-span-2 border-t pt-2.5 sm:col-span-1 sm:border-t-0 sm:pt-0')}>
              <div className="text-[13px] text-stone-600">{label}</div>
              <div className="mt-0.5 text-lg font-semibold leading-[26px] tabular-nums text-stone-900">{cad(cents)}</div>
              <div className="text-xs text-stone-500">{empty ? '–' : caption}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card id="cp-payments" title={mt('cpPayments')} action={data.payments.length ? <TertiaryLink href="/manager/dashboard?view=revenue">{mt('cpOpenInRevenue')}</TertiaryLink> : undefined}>
        {data.payments.length ? <>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs font-medium text-stone-500">
              <th className="hidden pb-2 pr-3 font-medium sm:table-cell">{mt('cpColPaidOn')}</th><th className="pb-2 pr-3 font-medium">{mt('cpColFor')}</th>
              <th className="hidden pb-2 pr-3 text-right font-medium sm:table-cell">{mt('cuMoneyPaid')}</th><th className="hidden pb-2 pr-3 text-right font-medium sm:table-cell">{mt('cuMoneyRefunded')}</th>
              <th className="pb-2 text-right font-medium">{mt('cpColYourPayout')}</th></tr></thead>
            <tbody>{data.payments.map(row => (
              <tr key={row.id} className={cn('border-t align-top', rule)}>
                <td className="hidden whitespace-nowrap py-2.5 pr-3 sm:table-cell">{shortMoment(row.paidAt, tz, locale)}</td>
                <td className="py-2.5 pr-3">
                  {row.bookingId ? <Link href={`/manager/booking/${row.bookingId}`} className={cn('hover:underline', focusRing)}><When text={visitLine(mt, row.startsAt, row.endsAt, tz, locale) || row.reference || ''} /></Link> : row.reference}
                  <span className={cn(sub, 'block sm:hidden')}><Facts items={[row.refundedCents ? mt('cpPaidRefunded', { paid: cad(row.amountCents), refunded: cad(row.refundedCents) }) : mt('cpPaid', { amount: cad(row.amountCents) }), shortMoment(row.paidAt, tz, locale)]} /></span>
                </td>
                <td className="hidden whitespace-nowrap py-2.5 pr-3 text-right tabular-nums sm:table-cell">{cad(row.amountCents)}</td>
                <td className="hidden whitespace-nowrap py-2.5 pr-3 text-right tabular-nums sm:table-cell">{row.refundedCents ? `−${cad(row.refundedCents)}` : <span className="text-stone-500">{cad(0)}</span>}</td>
                <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{row.payoutCents == null ? <span className="text-stone-500">–</span> : cad(row.payoutCents)}
                  <span className={cn(sub, 'block whitespace-normal')}>{payoutLine(row, tz, locale)}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-pretty text-xs leading-4 text-stone-500">{mt('cpPayoutFootnote')}</p>
        </> : <Empty title={mt('cpNoPayments')} text={mt('cpNoPaymentsText', { name })} />}
      </Card>

      <Card id="cp-claims" title={mt('cpDamageClaims')} count={data.claims.length || undefined}>
        {data.claims.length ? (
          <table className="w-full border-collapse text-sm">
            <thead><tr className="text-left text-xs font-medium text-stone-500"><th className="pb-2 pr-3 font-medium">{mt('cpColClaim')}</th>
              <th className="hidden pb-2 pr-3 font-medium sm:table-cell">{mt('cpColStatus')}</th><th className="pb-2 text-right font-medium">{mt('cpColAmount')}</th></tr></thead>
            <tbody>{data.claims.map(claim => {
              const status = claim.status === 'in_review' ? <span className={badge.attention}>{claimStatus(claim.status, name)}</span> : claimStatus(claim.status, name);
              return (
                <tr key={claim.id} className={cn('border-t align-top', rule)}>
                  <td className="py-2.5 pr-3"><Link href={`/manager/dashboard?view=damage-claims&claim=${claim.id}`} className={cn('font-medium text-stone-900 hover:underline', focusRing)}>{claim.title}</Link>
                    {claim.reference && <span className={cn(sub, 'block')}>{claim.reference}</span>}<span className="mt-1 block sm:hidden">{status}</span></td>
                  <td className="hidden py-2.5 pr-3 sm:table-cell">{status}</td>
                  <td className="whitespace-nowrap py-2.5 text-right tabular-nums">{claim.amountCents != null ? cad(claim.amountCents) : '–'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <Empty tight title={mt('cpNoClaims')} text={mt('cpNoClaimsText')} />}
      </Card>
    </div>
  );
}

/* ───────────── Access and documents ───────────── */

const stageKey = { requested: 'cuStageRequested', localCooksApproved: 'cuStageLocalCooks', documentsSubmitted: 'cpStageDocumentsSent', youApproved: 'cuStageYou' } as const;
const tourStatusKey: Record<string, string> = {
  pending: 'cuTourStatusPending', pending_local_cooks: 'cuTourStatusPending', confirmed: 'cuTourStatusConfirmed', completed: 'cuTourStatusCompleted',
  cancelled: 'cuTourStatusCancelled', no_show: 'cuTourStatusNoShow',
};

export function DocsTab({ data, locale, applicationHref }: TabProps & { applicationHref: string | null }) {
  const tz = data.location.timezone, name = data.customer.name;
  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <Card id="cp-application" title={mt('cpAccessApplication')} action={applicationHref ? <TertiaryLink href={applicationHref}>{mt('cpOpenApplication')}</TertiaryLink> : undefined}>
        {data.application ? <>
          <ol className="mb-2 mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {data.application.stages.map(stage => (
              <li key={stage.key} className={cn('border-t-[3px] pt-2.5 text-[13px] leading-[18px]', stage.at ? 'border-emerald-500' : 'border-stone-200')}>
                <b className="block text-sm font-medium leading-5 text-stone-900">{mt(stageKey[stage.key])}</b>
                <span className="text-stone-600">{stage.at ? formatDay(stage.at, tz, locale) : mt('cpNotYet')}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-pretty text-xs leading-4 text-stone-500">{mt('cpApplicationFootnote', { name })}</p>
        </> : <Empty tight title={mt('cuNoApplication')} text={mt('cpNoApplicationText', { name })} />}
      </Card>
      <Card id="cp-tours" title={mt('cuSecTours')} count={data.tours.length || undefined}>
        {data.tours.length ? <div>{data.tours.map(tour => (
          <Link key={tour.id} href={`/manager/tours/${tour.id}`} className={cn('-mx-2 block rounded-lg px-2 py-2.5 hover:bg-stone-50 [&+&]:rounded-t-none [&+&]:border-t', rule, focusRing)}>
            <span className="block font-medium text-stone-900">{visitLine(mt, tour.scheduledAt, new Date(Date.parse(tour.scheduledAt) + tour.durationMinutes * 60_000).toISOString(), tz, locale)}</span>
            <span className={cn(sub, 'block')}><Facts items={[tour.kitchenName, mt(tourStatusKey[tour.status] ?? 'cuTourStatusPending'), tour.feedbackSubmitted ? mt('cuTourFeedbackShared') : null]} /></span>
          </Link>
        ))}</div> : <Empty tight title={mt('cpNoTours')} text={mt('cpNoToursText', { name })} />}
      </Card>
    </div>
  );
}
