import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { Icon } from '@iconify/react';
import { Button } from '@/components/ui/button';
import type { BookingEligibility } from '@/hooks/use-booking-eligibility';

const SUPPORT_MAILTO = 'mailto:support@localcooks.ca';

/**
 * Why this chef cannot start a new booking here, and the one next step, shown before they pick dates.
 * Existing bookings are never affected, and every state says so.
 */
export function BookingEligibilityBanner({ eligibility, locationName }: { eligibility: BookingEligibility | null; locationName: string }) {
  const { t, i18n } = useTranslation('booking');
  const [, navigate] = useLocation();
  if (!eligibility || eligibility.canBook) return null;

  const document = eligibility.document;
  const documentName = !document ? '' : document.key === 'foodEstablishmentCert'
    ? t('accessDocumentFoodEstablishmentCert', { defaultValue: 'Food Establishment Licence' })
    : t('accessDocumentFoodSafetyLicense', { defaultValue: 'Food Safety Certificate' });
  const date = document?.expiry
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${document.expiry}T00:00:00Z`))
    : '';
  const location = locationName;
  const renewPath = eligibility.actionUrl || '/dashboard?view=kitchen-requests';
  const go = (path: string, label: string) => (
    <Button type="button" variant="outline" size="sm" onClick={() => navigate(path)}>{label}</Button>
  );
  const renewLabel = t('accessActionRenew', { defaultValue: 'Upload a renewed document' });
  const messageLabel = t('accessActionMessage', { location, defaultValue: 'Message {location}' });
  const applicationLabel = t('accessActionApplication', { defaultValue: 'View your application' });
  const support = (
    <Button asChild variant="ghost" size="sm">
      <a href={SUPPORT_MAILTO}>{t('accessActionSupport', { defaultValue: 'Contact Local Cooks' })}</a>
    </Button>
  );

  let title: string;
  let body: string | null = t('accessBlockedExistingBookings', { defaultValue: 'Your existing bookings are not affected.' });
  let actions: JSX.Element;
  switch (eligibility.status) {
    case 'document_expired':
      title = date
        ? t('accessBlockedDocumentExpired', { document: documentName, date, defaultValue: 'Your {document} expired on {date}. Upload a renewed one to book again.' })
        : t('accessBlockedDocumentExpiredNoDate', { document: documentName, defaultValue: 'Your {document} has expired. Upload a renewed one to book again.' });
      actions = go(renewPath, renewLabel);
      break;
    case 'renewal_under_review':
      title = t('accessBlockedRenewalReview', { document: documentName, location, defaultValue: 'Your renewal is under review. You can book again once {location} approves your renewed {document}.' });
      actions = go(renewPath, t('accessActionRenewalStatus', { defaultValue: 'See renewal status' }));
      break;
    case 'document_review_required':
      title = t('accessBlockedDocumentReview', { document: documentName, defaultValue: 'Your {document} needs a valid expiry date and approval before you can book. Upload a renewed one and we will let you know when it has been reviewed.' });
      actions = go(renewPath, renewLabel);
      break;
    case 'access_ended':
      title = t('accessBlockedEnded', { location, defaultValue: 'Your access to {location} has ended. Contact {location} or Local Cooks if you would like to book here again.' });
      actions = <>{go('/dashboard?view=messages', messageLabel)}{support}</>;
      break;
    case 'awaiting_final_approval':
      title = t('accessBlockedAwaitingFinal', { defaultValue: "Waiting for the kitchen's final approval" });
      body = t('accessBlockedAwaitingFinalBody', { location, defaultValue: '{location} is reviewing your application and documents. You can book as soon as they give final approval.' });
      actions = go('/dashboard?view=kitchen-requests', applicationLabel);
      break;
    case 'application_required':
      title = t('accessBlockedApplicationRequired', { location, defaultValue: 'Apply to {location} to book' });
      body = t('accessBlockedApplicationRequiredBody', { defaultValue: 'You need an approved application before you can book this kitchen.' });
      actions = go('/dashboard?view=kitchen-requests', applicationLabel);
      break;
    case 'rejected':
    case 'cancelled':
      title = t('accessBlockedNotApproved', { location, defaultValue: 'Your application to {location} is not approved' });
      body = t('accessBlockedNotApprovedBody', { location, defaultValue: 'Contact {location} or Local Cooks to find out your next step.' });
      actions = <>{go('/dashboard?view=messages', messageLabel)}{support}</>;
      break;
    default:
      title = t('accessBlockedGeneric', { defaultValue: 'You cannot book here right now' });
      body = eligibility.message || null;
      actions = support;
  }

  return (
    <section role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" data-booking-eligibility={eligibility.status}>
      <Icon icon="mdi:alert-circle-outline" className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        {body ? <p className="text-sm">{body}</p> : null}
        <div className="flex flex-wrap items-center gap-2 pt-2">{actions}</div>
      </div>
    </section>
  );
}
