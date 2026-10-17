import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CancellationPolicySummary, cancellationDeadlineLabel, type PolicyResponse } from './CancellationPolicySummary';
import { freeCancelResponseCap } from '@shared/booking-response-deadline';

/**
 * The "Cancellation" block on the review step (#52): a calm one-line headline, the short-notice / near-deadline warnings
 * always visible, and the full terms behind "Details". Consent is given by selecting Checkout (see CheckoutConsentNotice);
 * the wording shown here is disclosure food-corridor-v3.
 */
export function CheckoutCancellationDisclosure({ policy, startAt, detailsOpen, onDetailsOpenChange, detailsId, multiDay = false }: {
  policy?: PolicyResponse; startAt?: string; detailsOpen?: boolean; onDetailsOpenChange?: (open: boolean) => void; detailsId?: string; multiDay?: boolean;
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
  return <section className="space-y-2 rounded-xl border p-3 sm:p-4" aria-label={t('cpTitle')}>
    <h3 className="text-sm font-semibold">{t('cpCheckoutTitle')}</h3>
    {!policy ? <p role="alert" className="text-sm">{t('cpError')}</p> : <>
      {multiDay && startAt ? <p className="text-sm leading-relaxed" data-testid="cancel-headline">{t('mdCancellation', {
        deadline: cancellationDeadlineLabel(startAt, policy.policy.noticeHours, policy.timezone, i18n.language), charge: `${policy.policy.lateChargePercent}%`,
      })}</p> : shortNotice
        ? <p className={warning} data-testid="cancel-short-notice">{t('cpShort', { hours: policy.policy.noticeHours, charge })}</p>
        : <p className="text-sm leading-relaxed" data-testid="cancel-headline">{startAt
          ? t('cpFreeUntil', { deadline: cancellationDeadlineLabel(startAt, policy.policy.noticeHours, policy.timezone, i18n.language) })
          : t('cpFreeHours', { hours: policy.policy.noticeHours })}</p>}
      {!multiDay && nearDeadline && <p className={warning} data-testid="cancel-near-deadline">{t('cpNearDeadline', { charge })}</p>}
      <button type="button" className="min-h-[44px] text-sm font-medium underline underline-offset-2 sm:min-h-0" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen(!open)}>{t(open ? 'cpHideDetails' : 'cpDetails')}</button>
      {open && <div id={panelId} className="space-y-2 border-t pt-2 text-sm text-muted-foreground" data-testid="cancel-details">
        {/* Before confirmation nothing is charged — only a card hold, released in full on withdrawal. */}
        <p className="leading-relaxed" data-testid="cancel-pre-confirmation">{t('preConfirmationRefundTitle')}</p>
        {!multiDay && !shortNotice && <CancellationPolicySummary policy={policy.policy} timezone={policy.timezone} startAt={startAt} />}
        {!shortNotice && !nearDeadline && <p className="leading-relaxed">{t('cpResponseBefore')}</p>}
        {/* Owner (Oct 15): part of every policy the chef accepts (since disclosure food-corridor-v2). */}
        <p className="leading-relaxed" data-testid="cancel-no-show">{t('cpNoShow')}</p>
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
