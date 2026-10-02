import { useTranslation } from 'react-i18next';
import { bookingOperationsComplete } from '@shared/booking-attendance';

export function BookingOperationsStatus({ booking }: { booking: Parameters<typeof bookingOperationsComplete>[0] }) {
  const { t } = useTranslation('chef');
  try {
    if (!bookingOperationsComplete(booking)) return null;
  } catch { return null; } // Invalid legacy schedules require reservation review.
  return <p className="text-xs text-muted-foreground">{t('bookingAttendanceEnded')}</p>;
}
