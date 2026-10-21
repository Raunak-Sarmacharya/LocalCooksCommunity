/**
 * Add-ons on the booking page: two fixed sub-blocks (design-booking-consolidation.md §2.8). Storage is a compact row
 * per item with no storage workflow here; `linkTo` is reserved for the future "Manage my storage" page and is left
 * unset today. Equipment: one row per paid rental with its days (Airbnb/Peerspace), and the kitchen's included
 * equipment folded into one "Included with the kitchen" line; a row lists its days separately only when they differ.
 */
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { StorageIcon, EquipmentIcon } from '@/components/ui/inventory-icons';
import { cn } from '@/lib/utils';

type Row = { id: number; name: string; detail?: string | null; price: string; struck: boolean; chip: ReactNode; actions?: ReactNode;
  /** Per-day lines inside the row (a multi-day rental whose days don't share one status, or a day with its own action). */
  days?: Array<{ key: number; label: string; price: string; struck: boolean; chip: ReactNode; actions?: ReactNode }> };

function Rows({ rows, linkTo }: { rows: Row[]; linkTo?: (id: number) => string }) {
  return <ul className="divide-y divide-border/60">
    {rows.map(row => {
      const name = <span className={cn('text-sm font-medium', row.struck && 'text-muted-foreground line-through')}>{row.name}</span>;
      return <li key={row.id} className="py-3 first:pt-0 last:pb-0">
        <div className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1', row.struck && 'opacity-70')}>
          <div className="min-w-0">
            {linkTo ? <a href={linkTo(row.id)} className="underline-offset-4 hover:underline">{name}</a> : name}
            {row.detail && <p className="text-[13px] leading-[18px] text-muted-foreground">{row.detail}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {row.actions}
            <span className={cn('text-sm tabular-nums', row.struck && 'text-muted-foreground line-through')}>{row.price}</span>
            {row.chip}
          </div>
        </div>
        {row.days && <ul className="mt-2 space-y-1.5 border-l-2 border-border/60 pl-3" data-testid="equipment-row-days">
          {row.days.map(day => <li key={day.key} className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]', day.struck && 'opacity-70')}>
            <span className={cn(day.struck && 'text-muted-foreground line-through')}>{day.label}</span>
            <span className="flex flex-wrap items-center gap-3">
              {day.actions}
              <span className={cn('tabular-nums', day.struck && 'text-muted-foreground line-through')}>{day.price}</span>
              {day.chip}
            </span>
          </li>)}
        </ul>}
      </li>;
    })}
  </ul>;
}

export function StorageRows({ title, rows, linkTo }: { title: string; rows: Row[]; linkTo?: (storageBookingId: number) => string }) {
  if (!rows.length) return null;
  return <div className="space-y-2" data-testid="storage-rows">
    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"><StorageIcon className="h-3.5 w-3.5" />{title}</h3>
    <Rows rows={rows} linkTo={linkTo} />
  </div>;
}

export function EquipmentRows({ title, rows, included }: { title: string; rows: Row[];
  included?: { label: string; items: Array<{ key: number; name: string; note?: string | null }> } }) {
  if (!rows.length && !included?.items.length) return null;
  return <div className="space-y-2" data-testid="equipment-rows">
    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"><EquipmentIcon className="h-3.5 w-3.5" />{title}</h3>
    <Rows rows={rows} />
    {!!included?.items.length && <details className={cn('group', rows.length > 0 && 'border-t border-border/60 pt-1')} data-testid="included-equipment">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        {included.label}<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <ul className="space-y-1.5 pb-1">
        {included.items.map(item => <li key={item.key} className="text-sm">
          {item.name}{item.note && <span className="text-[13px] text-muted-foreground"> · {item.note}</span>}
        </li>)}
      </ul>
    </details>}
  </div>;
}
