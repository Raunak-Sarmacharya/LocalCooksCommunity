/**
 * The booking page "Now" card (design-booking-consolidation.md §2.1, §6, §7): who · when · ONE pill + ONE sentence ·
 * attention rows (things that need the viewer's answer) · the state body · one row of at most three secondary links.
 * Presentational: the page decides the content with `bookingNowContent` and composes the slots.
 */
import { lazy, Suspense, useState, type ComponentPropsWithoutRef, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/reui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SmartImage } from '@/components/ui/smart-image';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DamageClaimCard } from '@/components/booking/DamageClaimCards';
import { claimMoney, claimPayByDate, claimWhen, type DamageClaimCardData } from '@/lib/damage-claims';
import { claimBookingHeld } from '@shared/damage-claims';
import type { BookingPillTone } from '@/lib/booking-header-state';
import { cn } from '@/lib/utils';

const ClaimPayment = lazy(() => import('./DamageClaimPayment'));
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One badge set for every booking status (lists and header): soft surface, small leading dot. */
const PILL: Record<BookingPillTone, { surface: string; dot: string }> = {
  amber: { surface: 'border-amber-200 bg-amber-50 text-amber-900', dot: 'bg-amber-500' },
  blue: { surface: 'border-sky-200 bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
  green: { surface: 'border-emerald-200 bg-emerald-50 text-emerald-900', dot: 'bg-emerald-500' },
  purple: { surface: 'border-violet-200 bg-violet-50 text-violet-900', dot: 'bg-violet-500' },
  neutral: { surface: 'border-border bg-muted text-foreground', dot: 'bg-foreground/60' },
  grey: { surface: 'border-border bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  red: { surface: 'border-red-200 bg-red-50 text-red-900', dot: 'bg-red-500' },
};

export function StatusPill({ tone, children, className }: { tone: BookingPillTone; children: ReactNode; className?: string }) {
  return <Badge variant="outline" className={cn('gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium shadow-none', PILL[tone].surface, className)}
    data-testid="booking-status-pill" data-tone={tone}>
    <span className={cn('h-1.5 w-1.5 rounded-full', PILL[tone].dot)} aria-hidden />{children}
  </Badge>;
}

/**
 * A row inside the Now card that needs (warning) or informs (info) the viewer. Built on reui/alert, fades in.
 * `as="plain"` keeps a caller's own chrome (the standalone extra-time card uses it).
 */
export function NowAttentionRow({ as, tone = 'warning', className, children, ...props }: ComponentPropsWithoutRef<'div'> & { as?: 'plain'; tone?: 'warning' | 'info' }) {
  if (as === 'plain') return <div className={className} {...props}>{children}</div>;
  return <Alert variant={tone === 'warning' ? 'warning' : 'default'} role="group" {...props}
    className={cn('block space-y-2 p-4 text-foreground motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200',
      tone === 'info' && 'bg-muted/30', className)}>
    {children}
  </Alert>;
}

export type NowSecondaryLink = { muted?: boolean; key: string; label: string; onSelect?: () => void; href?: string; icon?: ComponentType<{ className?: string }>; testId?: string };

export function BookingNowCard({ reference, bookedOn, title, subtitle, leading, heroImage, actions, whenLine, pill, sentence, sentenceExtra, attention, body, secondary, footnote, labels }: {
  reference: string; bookedOn: string; title: string; subtitle?: ReactNode; leading?: ReactNode;
  /** Chef view: the kitchen's cover photo. */
  heroImage?: string | null;
  actions: ReactNode; whenLine: string; pill: { label: string; tone: BookingPillTone }; sentence: string; sentenceExtra?: ReactNode;
  attention?: ReactNode; body?: ReactNode; secondary: NowSecondaryLink[]; footnote?: ReactNode;
  labels: { header: string; secondary: string };
}) {
  return <Card className="overflow-hidden rounded-2xl border-border/70 shadow-none transition-shadow [@media(hover:hover)]:hover:shadow-sm" data-testid="now-card">
    {heroImage && <div className="sm:hidden" aria-hidden>
      <SmartImage src={heroImage} alt="" className="aspect-[16/9] max-h-52 w-full object-cover" />
    </div>}
    <header className={cn('relative space-y-4 bg-card p-4 sm:p-6', heroImage && 'max-sm:-mt-5 max-sm:rounded-t-2xl')} aria-label={labels.header} data-testid="booking-header">
      <p className="flex flex-wrap items-center gap-x-2 text-[13px] leading-[18px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">{reference}</span>
        <span aria-hidden>·</span>
        <span>{bookedOn}</span>
      </p>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-4">
          {heroImage && <SmartImage src={heroImage} alt="" className="hidden aspect-[16/9] w-36 shrink-0 rounded-xl object-cover sm:block" />}
          {leading}
          <div className="min-w-0">
            <h1 className="break-words text-[22px] font-semibold leading-7 tracking-tight" data-testid="booking-who">{title}</h1>
            {subtitle}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      </div>
      <p className="text-[15px] font-medium leading-[22px] tabular-nums" data-testid="booking-when">{whenLine}</p>
      <div className="flex flex-col items-start gap-2">
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
        <p role="status" className="text-[15px] leading-[22px] text-foreground/90" data-testid="booking-next-step">{sentence}</p>
        {sentenceExtra}
      </div>
      {attention}
      {body}
      {secondary.length > 0 && <nav aria-label={labels.secondary} className="flex flex-wrap items-center gap-x-5" data-testid="now-secondary">
        {secondary.map(link => {
          const content = <>{link.icon && <link.icon className="mr-1.5 h-4 w-4" aria-hidden />}{link.label}</>;
          const className = cn(link.muted && '!text-muted-foreground !font-normal', 'inline-flex min-h-11 items-center text-[13px] font-medium leading-[18px] text-foreground/80 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm');
          return link.href
            ? <a key={link.key} href={link.href} className={className} data-testid={link.testId} onClick={link.onSelect ? event => { event.preventDefault(); link.onSelect!(); } : undefined}>{content}</a>
            : <button key={link.key} type="button" className={className} data-testid={link.testId} onClick={link.onSelect}>{content}</button>;
        })}
      </nav>}
      {footnote}
    </header>
  </Card>;
}

/** Collapses a long block to its first lines with "Show all" (progressive disclosure, §7). */
export function ClampedBlock({ children, showAll, showLess }: { children: ReactNode; showAll: string; showLess: string }) {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  return <div className="rounded-xl bg-muted/30 px-4 py-3" data-testid="now-body">
    <div ref={node => { if (node && !open) { const over = node.scrollHeight > node.clientHeight + 2; if (over !== overflowing) setOverflowing(over); } }}
      className={cn('relative', !open && 'max-h-[5.5rem] overflow-hidden', !open && overflowing && '[mask-image:linear-gradient(to_bottom,black_60%,transparent)]')}>
      {children}
    </div>
    {(overflowing || open) && <button type="button" className="mt-1 min-h-11 text-[13px] font-medium underline underline-offset-4" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      {open ? showLess : showAll}
    </button>}
  </div>;
}

// ── Damage and cleaning claims in the Now card (§1.5) ──────────────────────────────────────────────────────────

/** Statuses after which a claim is history (Visit details), never a Now row. */
export const CLOSED_CLAIM_STATUSES = ['charge_succeeded', 'resolved', 'rejected', 'expired', 'withdrawn'];
const isClosedClaim = (claim: DamageClaimCardData) => CLOSED_CLAIM_STATUSES.includes(claim.status) || claim.resolutionType === 'withdrawn';
/** Same rule the claim card uses for its Pay button. */
export const chefCanPayClaim = (claim: DamageClaimCardData) => claim.claimVersion === 2 && claim.chefOwes
  && ['submitted', 'approved', 'partially_approved', 'charge_failed', 'chef_accepted', 'escalated'].includes(claim.status) && !claim.compensationPending;

/** Which claims belong in the Now card for this viewer. The chef never sees a claim before Local Cooks sends it. */
export function nowClaims(claims: DamageClaimCardData[] | undefined, manager: boolean) {
  return (claims || []).filter(claim => !isClosedClaim(claim) && (manager || claim.chefVisible !== false) && (manager || !['in_review', 'awaiting_kitchen'].includes(claim.status)));
}

export function NowClaimRows({ claims, manager, chefName, timezone, allowPrimary = false, onChanged, payingId, onPayingChange, payInBarFor = null }: {
  claims: DamageClaimCardData[]; manager: boolean; chefName: string; timezone: string; allowPrimary?: boolean; onChanged: () => void;
  /** Controlled payment step: on narrow screens the page's sticky bar holds "Pay $X" and opens it here. */
  payingId?: number | null; onPayingChange?: (id: number | null) => void;
  /** The sticky bar already holds this claim's Pay (narrow screens): don't repeat it in the row. */
  payInBarFor?: number | null;
}) {
  const { t: tcStrict, i18n } = useTranslation('chef');
  const { t: tbStrict } = useTranslation('booking');
  const tc = tcStrict as unknown as Translate, tb = tbStrict as unknown as Translate;
  const [open, setOpen] = useState<DamageClaimCardData | null>(null);
  const [ownPaying, setOwnPaying] = useState<number | null>(null);
  const payingKey = payingId !== undefined ? payingId : ownPaying;
  const setPaying = (claim: DamageClaimCardData | null) => { setOwnPaying(claim?.id ?? null); onPayingChange?.(claim?.id ?? null); };
  const paying = payingKey == null ? null : claims.find(claim => claim.id === payingKey) ?? null;
  const rows = nowClaims(claims, manager);
  if (!rows.length) return null;
  const firstPayable = manager ? null : rows.find(chefCanPayClaim)?.id ?? null;
  const zone = (claim: DamageClaimCardData) => claim.visitEvidence?.timezone || timezone;
  const amount = (claim: DamageClaimCardData) => claimMoney(claim.amountCents, i18n.language);
  const kitchenOf = (claim: DamageClaimCardData) => claim.visitEvidence?.kitchenName || tb('dcV2Kitchen');
  const details = (claim: DamageClaimCardData, label = tc('bnClaimSeeDetails')) =>
    <button type="button" className="min-h-11 text-[13px] font-medium underline-offset-4 hover:underline" onClick={() => setOpen(claim)}>{label}</button>;

  return <div className="space-y-3" data-testid="now-claims">
    {rows.map(claim => {
      if (!manager && chefCanPayClaim(claim)) {
        const primary = allowPrimary && claim.id === firstPayable;
        const disputable = ['submitted', 'under_review'].includes(claim.status);
        return <NowAttentionRow key={claim.id} data-testid="claim-attention">
          <p className="text-sm font-medium">{tb('dcV2ClaimTitle', { kitchen: kitchenOf(claim), amount: amount(claim) })}</p>
          <p className="text-xs text-muted-foreground">{claim.upheldAt && claimBookingHeld(claim) ? tb('dcV2PausedShort') : claim.upheldAt ? tc('bnClaimUpheldChef', { date: claimPayByDate(claim.upheldAt, zone(claim), i18n.language) })
            : claim.status === 'submitted' ? tb('dcV2RespondBy', { when: claimWhen(claim.deadline, zone(claim), i18n.language) }) : tb(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}</p>
          <div className="flex flex-wrap gap-2">
            {payInBarFor !== claim.id && <Button type="button" className="min-h-11" variant={primary ? 'default' : 'outline'} {...(primary ? { 'data-primary-action': 'true' } : {})}
              disabled={claim.paymentBusy} onClick={() => setPaying(claim)}>{tb('dcV2Pay', { amount: amount(claim) })}</Button>}
            <Button type="button" className="min-h-11" variant="outline" onClick={() => setOpen(claim)}>{disputable ? tb('dcV2Dispute') : tc('bnClaimSeeDetails')}</Button>
          </div>
        </NowAttentionRow>;
      }
      if (manager && claim.status === 'awaiting_kitchen') {
        return <NowAttentionRow key={claim.id} data-testid="claim-attention">
          <p className="text-sm font-medium">{tc('bnClaimAwaitingKitchen')}</p>
          {claim.reviewRequest && <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">“{claim.reviewRequest}”</p>}
          <Button type="button" className="min-h-11" variant="outline" onClick={() => setOpen(claim)}>{tb('dcV2Reply')}</Button>
        </NowAttentionRow>;
      }
      const line = manager
        ? claim.status === 'in_review' ? tc('bnClaimInReview', { amount: amount(claim) })
          : ['submitted', 'approved', 'partially_approved', 'chef_accepted'].includes(claim.status)
            ? claim.upheldAt ? tc('bnClaimUpheldManager', { chef: chefName }) : tc('bnClaimSentToChef', { chef: chefName, when: claimWhen(claim.deadline, zone(claim), i18n.language) })
          : ['chef_disputed', 'escalated', 'under_review'].includes(claim.status) ? tc('bnClaimDisputedManager', { chef: chefName })
          : `${tc('bnClaimLabel', { amount: amount(claim) })} · ${tb(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}`
        : ['chef_disputed', 'under_review'].includes(claim.status) ? tc('bnClaimReviewingChef', { kitchen: kitchenOf(claim) })
          : `${tc('bnClaimLabel', { amount: amount(claim) })} · ${tb(`dcV2Status_${claim.status}`, { defaultValue: claim.status })}`;
      return <div key={claim.id} className="flex flex-wrap items-center justify-between gap-x-4 rounded-lg bg-muted/30 px-4 py-1" data-testid="claim-line">
        <p className="py-2 text-sm">{line}</p>{details(claim)}
      </div>;
    })}
    <Sheet open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="mb-4"><SheetTitle>{open ? tb(manager ? 'dcV2ViewingTitle' : 'dcV2ClaimTitle', { kitchen: kitchenOf(open), amount: amount(open) }) : ''}</SheetTitle><SheetDescription className="sr-only">{open ? amount(open) : ''}</SheetDescription></SheetHeader>
        {open && <DamageClaimCard claim={open} manager={manager} hideTitle onChanged={() => { setOpen(null); onChanged(); }} />}
      </SheetContent>
    </Sheet>
    {paying && <Suspense fallback={<p role="status" className="text-sm">{tb('dcV2Loading')}</p>}>
      <ClaimPayment claim={paying} onClose={() => setPaying(null)} onPaid={() => { setPaying(null); onChanged(); }} />
    </Suspense>}
  </div>;
}

/** History line for a closed claim (Visit details). */
export function closedClaimLine(claim: DamageClaimCardData, manager: boolean, t: (key: string, options?: Record<string, unknown>) => string, tb: (key: string, options?: Record<string, unknown>) => string, locale: string, timezone: string) {
  const amount = claimMoney(claim.amountCents, locale);
  const paidAt = claim.status === 'charge_succeeded' ? [...claim.history].reverse().find(item => item.status === 'charge_succeeded')?.createdAt : undefined;
  const date = paidAt ? new Intl.DateTimeFormat(locale, { timeZone: claim.visitEvidence?.timezone || timezone, month: 'short', day: 'numeric' }).format(new Date(paidAt)) : null;
  if (date) return t(manager && claim.kitchenPaid ? 'vrClaimPaidToYou' : 'vrClaimPaid', { amount, date });
  return t('vrClaimClosed', { amount, status: tb(`dcV2Status_${claim.status}`, { defaultValue: claim.status }) });
}
export const closedClaims = (claims: DamageClaimCardData[] | undefined, manager: boolean) =>
  (claims || []).filter(claim => isClosedClaim(claim) && (manager || claim.chefVisible !== false));
