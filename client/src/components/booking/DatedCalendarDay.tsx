import { createContext, useContext, useRef } from 'react';
import { useDayRender, type DayProps } from 'react-day-picker';
import { cn } from '@/lib/utils';

export const DatedCalendarContext = createContext<{ reason: (date: Date) => string | null; announce: (message: string) => void; locale: string }>({
  reason: () => null, announce: () => {}, locale: 'en-CA',
});

/** An unavailable day remains focusable so touch and keyboard users can hear why. */
export function DatedCalendarDay(props: DayProps) {
  const { reason, announce, locale } = useContext(DatedCalendarContext);
  const ref = useRef<HTMLButtonElement>(null);
  const day = useDayRender(props.date, props.displayMonth, ref);
  const explanation = reason(props.date);
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(props.date);
  if (day.isHidden) return <div role="gridcell" />;
  if (!explanation) return <button {...day.buttonProps} ref={ref} type="button" role="gridcell" aria-label={dateLabel}
    className={cn(day.buttonProps.className, 'h-11 w-full max-w-[44px]', day.activeModifiers.selected && 'border-2 border-[#E10939] bg-[#FFF3F5] text-gray-900')}>
    {props.date.getDate()}</button>;
  const label = `${dateLabel}: ${explanation}`;
  return <button type="button" aria-disabled="true" aria-label={label} title={explanation}
    className="mx-auto flex h-11 w-full max-w-[44px] items-center justify-center rounded-full text-sm text-muted-foreground line-through focus-visible:ring-2 focus-visible:ring-[#E10939]"
    onFocus={() => announce(label)} onClick={() => announce(label)}>{props.date.getDate()}</button>;
}
