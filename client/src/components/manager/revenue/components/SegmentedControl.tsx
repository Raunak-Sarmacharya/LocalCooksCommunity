import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Pill filters as pressed buttons. (Radix ToggleGroup items are role="radio", which a global rule in index.css shrinks
 * to 16px circles, so it can't be used for text pills.)
 */
export function SegmentedControl<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (value: T) => void; label: string;
}) {
  return <div role="group" aria-label={label} className="flex flex-wrap gap-2">
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        value === option.value ? 'border-foreground bg-foreground text-background' : 'border-input bg-background text-foreground hover:bg-muted')}>
      {option.label}
    </button>)}
  </div>;
}
