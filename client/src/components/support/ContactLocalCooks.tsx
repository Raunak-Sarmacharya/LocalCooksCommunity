import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type SupportContext = {
  role: 'chef' | 'manager' | 'admin'; situation: string;
  bookingId?: number; bookingReference?: string | null; checkoutReference?: string | null;
  claimId?: number; changeId?: string; paymentReference?: string | null;
};

/** Only explicit public references: never serialize a booking/payment object or client secret. */
export function localCooksSupportHref(context: SupportContext, subject = 'Local Cooks support') {
  const reference = context.bookingReference || (context.bookingId ? `KB-${context.bookingId}` : context.checkoutReference);
  const body = [`Role: ${context.role}`, `Situation: ${context.situation}`,
    context.bookingId && `Booking: ${context.bookingReference || `KB-${context.bookingId}`}`,
    context.checkoutReference && `Checkout: ${context.checkoutReference}`,
    context.claimId && `Claim: ${context.claimId}`, context.changeId && `Change: ${context.changeId}`,
    context.paymentReference && `Payment: ${context.paymentReference}`].filter(Boolean).join('\n');
  return `mailto:support@localcooks.ca?subject=${encodeURIComponent(`${subject}${reference ? ` — ${reference}` : ''}`)}&body=${encodeURIComponent(`${body}\n\n`)}`;
}

export function ContactLocalCooks({ children, className = 'underline underline-offset-4', ...context }: SupportContext & { children?: ReactNode; className?: string }) {
  const { t } = useTranslation('booking');
  return <a className={className} href={localCooksSupportHref(context, t('supportEmailSubject'))}>{children || t('supportContact')}</a>;
}
