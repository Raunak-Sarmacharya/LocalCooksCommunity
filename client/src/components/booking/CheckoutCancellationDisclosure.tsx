import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CancellationPolicyTimeline, cancellationDeadlineLabel, type PolicyResponse } from './CancellationPolicySummary';
import { freeCancelResponseCap } from '@shared/booking-response-deadline';

/**
 * The "Cancellation" block on the review step (#52): a calm one-line headline, the short-notice / near-deadline warnings
 * always visible, and the full timeline behind "Details". Consent is given by selecting Checkout (see CheckoutConsentNotice);
 * the wording shown here is disclosure food-corridor-v3.
 */
export function CheckoutCancellationDisclosure({ policy, startAt, detailsOpen, onDetailsOpenChange, detailsId, bare = false }: {
  policy?: PolicyResponse; startAt?: string; detailsOpen?: boolean; onDetailsOpenChange?: (open: boolean) => void; detailsId?: string;
  /** Inside another card (the checkout price card): no box of its own, the card's type scale. */ bare?: boolean;
}) {
  const { t, i18n } = useTranslation('booking');
  const [ownOpen, setOwnOpen] = useState(false);
  const open = detailsOpen ?? ownOpen;
  const setOpen = (next: boolean) => { setOwnOpen(next); onDetailsOpenChange?.(next); };
  const fallbackId = useId();
  const panelId = detailsId ?? `cancellation-details-${fallbackId}`;
  const shortNotice = !!policy && !!startAt && Date.parse(startAt) - Date.now() < policy.policy.noticeHours * 3600000;
  // Booked just before the free-cancellation deadline: the kitchen may confirm after it passes, so say so plainly.
  const nearDeadline = !!policy && !!startAt && !shortNotice && policy.policy.noticeHours > 0
    && !freeCancelResponseCap({ createdAt: new Date(), startAt, freeCancelHours: policy.policy.noticeHours });
  const charge = policy ? t(policy.policy.lateChargePercent === 50 ? 'cpHalf' : 'cpFull') : '';
  const warning = 'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-relaxed';
  return <section className={bare ? 'space-y-1.5' : 'space-y-2 rounded-xl border p-3 sm:p-4'} aria-label={t('cpTitle')}>
    <h3 className="text-sm font-semibold text-gray-900">{t('cpCheckoutTitle')}</h3>
    {!policy ? <p role="alert" className="text-sm">{t('cpError')}</p> : <>
      {/* One headline for single and multi-day, in the sidebar's words with the real deadline. */}
      {shortNotice
        ? <p className={warning} data-testid="cancel-short-notice">{t('cpShort', { hours: policy.policy.noticeHours, charge })}</p>
        : <p className={bare ? 'text-sm leading-relaxed text-gray-600' : 'text-sm leading-relaxed'} data-testid="cancel-headline">{startAt
          ? t(policy.policy.lateChargePercent === 50 ? 'cpCheckoutHeadlineHalf' : 'cpCheckoutHeadline', { deadline: cancellationDeadlineLabel(startAt, policy.policy.noticeHours, policy.timezone, i18n.language) })
          : t(policy.policy.lateChargePercent === 50 ? 'cpSidebarSummaryHalf' : 'cpSidebarSummary', { hours: policy.policy.noticeHours })}</p>}
      {nearDeadline && <p className={warning} data-testid="cancel-near-deadline">{t('cpNearDeadline', { charge })}</p>}
      <button type="button" className="min-h-[44px] text-sm font-medium text-gray-900 underline underline-offset-4 sm:min-h-0" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>{t(open ? 'cpHideDetails' : 'cpDetails')}</button>
      {/* The same timeline as the kitchen page and the policy dialog (no-show, kitchen-cancels and multi-day rules included). */}
      {open && <div id={panelId} className="space-y-3 border-t pt-3" data-testid="cancel-details">
        <CancellationPolicyTimeline policy={policy.policy} startAt={startAt} timezone={policy.timezone} />
        {!shortNotice && !nearDeadline && <p className="text-sm leading-relaxed text-muted-foreground">{t('cpResponseBefore')}</p>}
      </div>}
    </>}
  </section>;
}

const POLICY_TOKEN = '\u0001policy\u0001', TERMS_TOKEN = '\u0001terms\u0001';

/** Clickwrap line under the primary button: selecting it is the acceptance (Airbnb / Peerspace pattern). */
export function CheckoutConsentNotice({ buttonLabel, onShowPolicy }: { buttonLabel: string; onShowPolicy: () => void }) {
  const { t } = useTranslation('booking');
  const link = 'font-medium text-foreground underline underline-offset-2';
  const parts: ReactNode[] = t('cpConsent', { button: buttonLabel, policy: POLICY_TOKEN, terms: TERMS_TOKEN }).split(/(\u0001policy\u0001|\u0001terms\u0001)/).map((part, index) =>
    part === POLICY_TOKEN ? <button key={index} type="button" className={link} onClick={onShowPolicy}>{t('cpConsentPolicy')}</button>
      : part === TERMS_TOKEN ? <a key={index} href="/terms" target="_blank" rel="noopener noreferrer" className={link}>{t('cpConsentTerms')}</a>
        : part);
  return <p className="text-xs leading-relaxed text-muted-foreground sm:text-center" data-testid="checkout-consent">{parts}</p>;
}
