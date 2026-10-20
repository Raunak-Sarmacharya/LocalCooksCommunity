import { createContext, useContext, useRef } from 'react';
import { useDayRender, type DayProps } from 'react-day-picker';
import { cn } from '@/lib/utils';

export const DatedCalendarContext = createContext<{ reason: (date: Date) => string | null; announce: (message: string) => void; locale: string;
  /** Bookable, but not every hour is free (booked hours, notice, weekly limit). */ partial?: (date: Date) => boolean; partialLabel?: string }>({
  reason: () => null, announce: () => {}, locale: 'en-CA',
});

/** An unavailable day remains focusable so touch and keyboard users can hear why. */
export function DatedCalendarDay(props: DayProps) {
  const { reason, announce, locale, partial, partialLabel } = useContext(DatedCalendarContext);
  const ref = useRef<HTMLButtonElement>(null);
  const day = useDayRender(props.date, props.displayMonth, ref);
  const explanation = reason(props.date);
  const dateLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(props.date);
  if (day.isHidden) return <div role="gridcell" />;
  if (!explanation) {
    const selected = !!day.activeModifiers.selected, limited = !!partial?.(props.date);
    // Fixed width AND height: a stretched width made the selected circle an oval.
    return <button {...day.buttonProps} ref={ref} type="button" role="gridcell" aria-label={limited && partialLabel ? `${dateLabel}: ${partialLabel}` : dateLabel}
      className={cn(day.buttonProps.className, 'relative mx-auto h-10 w-10 max-w-none shrink-0 rounded-full',
        selected && 'bg-[#E10939] font-semibold text-white hover:bg-[#c90832] hover:text-white focus:bg-[#E10939]')}>
      {props.date.getDate()}
      {limited && <span aria-hidden="true" className={cn('absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full', selected ? 'bg-white' : 'bg-amber-500')} />}
    </button>;
  }
  const label = `${dateLabel}: ${explanation}`;
  return <button type="button" aria-disabled="true" aria-label={label} title={explanation}
    className="mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm text-muted-foreground line-through focus-visible:ring-2 focus-visible:ring-[#E10939]"
    onFocus={() => announce(label)} onClick={() => announce(label)}>{props.date.getDate()}</button>;
}
