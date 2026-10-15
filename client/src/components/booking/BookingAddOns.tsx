/**
 * Add-ons on the booking page: two fixed sub-blocks (design-booking-consolidation.md §2.8). Storage is a compact row
 * per item with no storage workflow here; `linkTo` is reserved for the future "Manage my storage" page and is left
 * unset today. Equipment is unchanged in content (manager can answer a cancellation request inline).
 */
import type { ReactNode } from 'react';
import { StorageIcon, EquipmentIcon } from '@/components/ui/inventory-icons';
import { cn } from '@/lib/utils';

type Row = { id: number; name: string; detail?: string | null; price: string; struck: boolean; chip: ReactNode };

function Rows({ rows, actions, linkTo }: { rows: Row[]; actions?: (id: number) => ReactNode; linkTo?: (id: number) => string }) {
  return <ul className="divide-y divide-border/60">
    {rows.map(row => {
      const name = <span className={cn('text-sm font-medium', row.struck && 'text-muted-foreground line-through')}>{row.name}</span>;
      return <li key={row.id} className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3 first:pt-0 last:pb-0', row.struck && 'opacity-70')}>
        <div className="min-w-0">
          {linkTo ? <a href={linkTo(row.id)} className="underline-offset-4 hover:underline">{name}</a> : name}
          {row.detail && <p className="text-[13px] leading-[18px] text-muted-foreground">{row.detail}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {actions?.(row.id)}
          <span className={cn('text-sm tabular-nums', row.struck && 'text-muted-foreground line-through')}>{row.price}</span>
          {row.chip}
        </div>
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

export function EquipmentRows({ title, rows, actions }: { title: string; rows: Row[]; actions?: (equipmentBookingId: number) => ReactNode }) {
  if (!rows.length) return null;
  return <div className="space-y-2" data-testid="equipment-rows">
    <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"><EquipmentIcon className="h-3.5 w-3.5" />{title}</h3>
    <Rows rows={rows} actions={actions} />
  </div>;
}
