/**
 * "Visit details" (the spec's Visit record, §1.1/§2.1): one collapsed card, shown once a visit has started, holding
 * what happened — a vertical timeline (one line per arrival/departure, the check-in method said once), extra-time
 * history, closed claim lines, photos/checklists/notes, fix history and, for the kitchen, "Fix the visit record".
 * Content stays mounted while collapsed (hidden), so the page's controlled Fix dialog keeps working from the ⋯ menu.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

export type VisitTimelineEvent = { key: string; label: string; at?: string | null };

export function VisitTimeline({ events, label }: { events: VisitTimelineEvent[]; label: string }) {
  if (!events.length) return null;
  return <ol className="relative" aria-label={label} data-testid="visit-timeline">
    {events.map((event, index) => (
      <li key={event.key} className="relative flex gap-3 pb-4 last:pb-0">
        {index < events.length - 1 && <span className="absolute left-[5px] top-4 h-[calc(100%-0.5rem)] w-px bg-border" aria-hidden />}
        <span className="mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-background bg-foreground/40 ring-1 ring-border" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
          <p className="min-w-0 text-sm">{event.label}</p>
          {event.at && <p className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{event.at}</p>}
        </div>
      </li>
    ))}
  </ol>;
}

export function BookingVisitRecord({ title, events, timelineLabel, emptyText, extensions, claimLines = [], evidence, attendance, fixLabel, onFix, defaultOpen = false }: {
  title: string; events: VisitTimelineEvent[]; timelineLabel: string;
  /** Shown when nothing has been recorded yet, so an opened record is never blank. */
  emptyText?: string;
  /** `SessionExtensionsCard variant="record"`: renders nothing when there is no history. */
  extensions?: ReactNode;
  claimLines?: string[];
  evidence?: ReactNode;
  /** `BookingAttendancePanel embedded`: no status text, keeps the Fix dialog, fix history and a chef's no-show note. */
  attendance?: ReactNode;
  fixLabel?: string; onFix?: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return <section aria-label={title} data-testid="visit-record"><Card className="rounded-2xl border-border/70 shadow-none">
    <Collapsible open={open} onOpenChange={setOpen}>
      <h2 className="text-base font-semibold leading-6">
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 sm:py-4">
          {title}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
        </CollapsibleTrigger>
      </h2>
      <CollapsibleContent forceMount hidden={!open} className="space-y-5 px-4 pb-5 data-[state=open]:motion-safe:animate-in data-[state=open]:motion-safe:fade-in-0 data-[state=open]:motion-safe:duration-200 sm:px-6 sm:pb-6">
        <VisitTimeline events={events} label={timelineLabel} />
        {emptyText && !events.length && !claimLines.length && !evidence && <p className="text-sm text-muted-foreground" data-testid="visit-record-empty">{emptyText}</p>}
        {extensions}
        {claimLines.length > 0 && <ul className="space-y-1 text-sm" data-testid="visit-claim-lines">{claimLines.map(line => <li key={line}>{line}</li>)}</ul>}
        {evidence}
        {attendance}
        {onFix && fixLabel && <button type="button" className="min-h-11 text-[13px] font-medium underline-offset-4 hover:underline" onClick={onFix}>{fixLabel}</button>}
      </CollapsibleContent>
    </Collapsible>
  </Card></section>;
}
