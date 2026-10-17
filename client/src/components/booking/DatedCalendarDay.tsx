import { createContext, useContext } from 'react';
import { Day, type DayProps } from 'react-day-picker';

export const DatedCalendarContext = createContext<{ reason: (date: Date) => string | null; announce: (message: string) => void; locale: string }>({
  reason: () => null, announce: () => {}, locale: 'en-CA',
});

/** An unavailable day remains focusable so touch and keyboard users can hear why. */
export function DatedCalendarDay(props: DayProps) {
  const { reason, announce, locale } = useContext(DatedCalendarContext);
  const explanation = reason(props.date);
  if (!explanation) return <Day {...props} />;
  const label = `${new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(props.date)}: ${explanation}`;
  return <button type="button" aria-disabled="true" aria-label={label} title={explanation}
    className="mx-auto flex h-11 w-11 items-center justify-center rounded-full text-sm text-muted-foreground line-through focus-visible:ring-2 focus-visible:ring-[#E10939]"
    onFocus={() => announce(label)} onClick={() => announce(label)}>{props.date.getDate()}</button>;
}
