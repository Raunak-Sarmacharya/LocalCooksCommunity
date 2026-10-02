import { flexRender, type Row } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export function MobileTableCards<TData>({ rows, className, onRowClick, emptyMessage }: { rows: Row<TData>[]; className?: string; onRowClick?: (row: TData) => void; emptyMessage?: string }) {
  const { t } = useTranslation("common");
  if (!rows.length) return <div className={cn("rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground md:hidden", className)}>{emptyMessage || t("noResults")}</div>;

  return <div className={cn("space-y-3 md:hidden", className)}>
    {rows.map((row) => {
      const cells = row.getVisibleCells().filter((cell) => !(cell.column.columnDef.meta as { mobileHidden?: boolean } | undefined)?.mobileHidden);
      const details = cells.filter((cell) => cell.column.id !== "actions");
      const actions = cells.filter((cell) => cell.column.id === "actions");
      return <article key={row.id} tabIndex={onRowClick ? 0 : undefined} role={onRowClick ? "button" : undefined}
        onClick={(event) => { if (!(event.target as HTMLElement).closest("button, a, input, select, textarea, [role='menuitem']")) onRowClick?.(row.original); }}
        onKeyDown={(event) => { if (onRowClick && (event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); onRowClick(row.original); } }}
        className={cn("data-table-mobile-card min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-sm", onRowClick && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")}>
        {details.map((cell, index) => {
          const meta = cell.column.columnDef.meta as { mobileLabel?: string } | undefined;
          const label = meta?.mobileLabel || (typeof cell.column.columnDef.header === "string" ? cell.column.columnDef.header : cell.column.id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase()));
          return <div key={cell.id} className={cn("min-w-0", index === 0 && "border-b pb-3")}>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
            <div className={cn("min-w-0 break-words text-sm [overflow-wrap:anywhere]", index === 0 && "text-base font-semibold")}>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </div>
          </div>;
        })}
        {actions.length > 0 && <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          {actions.map((cell) => <div key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>)}
        </div>}
      </article>;
    })}
  </div>;
}
