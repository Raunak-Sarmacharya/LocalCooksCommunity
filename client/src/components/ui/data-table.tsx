"use client"

import * as React from "react"
import { useTranslation } from "react-i18next"
import { ColumnDef, ColumnFiltersState, SortingState, VisibilityState, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"

// Per-column mobile metadata. `meta` is untyped on ColumnDef, so it is read through this
// shape rather than cast at every call site.
export interface DataTableColumnMeta {
    /** Label shown beside the value in the mobile card view. Falls back to a string `header`. */
    mobileLabel?: string
    /** Drop this column from the mobile card view entirely (e.g. a desktop-only audit column). */
    mobileHidden?: boolean
    /**
     * How much of the mobile card's two-column grid this field takes. Default `"half"`. Use
     * `"full"` for a value that is too wide to read at half width (a row of chips, a progress
     * rail). Ignored for the FIRST detail column, which is always the card's full-width identity row.
     */
    mobileSpan?: "half" | "full"
}

interface DataTableProps<TData> {
    columns: ColumnDef<TData>[]
    data: TData[]
    filterColumn?: string
    filterPlaceholder?: string
    defaultSorting?: SortingState
    initialColumnVisibility?: VisibilityState
    pageSize?: number
    onRowClick?: (row: TData) => void
}

function readColumnMeta<TData, TValue>(columnDef: ColumnDef<TData, TValue>): DataTableColumnMeta {
    return (columnDef.meta as DataTableColumnMeta | undefined) ?? {}
}

function mobileLabelFor<TData, TValue>(columnDef: ColumnDef<TData, TValue>): string | undefined {
    const { mobileLabel } = readColumnMeta(columnDef)
    if (mobileLabel) return mobileLabel
    return typeof columnDef.header === "string" ? columnDef.header : undefined
}

// Row activation must not fire when the click landed on a control inside the row.
function isInteractiveTarget(target: EventTarget | null): boolean {
    return Boolean(
        (target as HTMLElement | null)?.closest?.(
            "button, a, input, select, textarea, [role='menuitem']"
        )
    )
}

export function DataTable<TData>({
    columns,
    data,
    filterColumn = "name",
    filterPlaceholder = undefined,
    defaultSorting = [],
    initialColumnVisibility = {},
    pageSize = 10,
    onRowClick,
}: DataTableProps<TData>) {
    const { t } = useTranslation("common")
    const resolvedFilterPlaceholder = filterPlaceholder ?? t("filterByName")
    const [sorting, setSorting] = React.useState<SortingState>(defaultSorting)
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialColumnVisibility)
    const [rowSelection, setRowSelection] = React.useState({})

    const table = useReactTable({
        data,
        columns,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onRowSelectionChange: setRowSelection,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
            rowSelection,
        },
        initialState: {
            pagination: { pageSize },
        },
    })

    const rows = table.getRowModel().rows
    const activateRow = (row: TData) => onRowClick?.(row)

    // A filter box that cannot filter is worse than no box. `filterColumn`
    // defaults to "name", which most tables do not have, so the input silently
    // swallowed keystrokes and looked like a second, broken search field.
    const filterableColumn = table.getColumn(filterColumn)

    return (
        <div className="w-full space-y-4">
            {filterableColumn && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center py-2 sm:py-4 w-full sm:w-auto">
                        <Input
                            placeholder={resolvedFilterPlaceholder}
                            value={(filterableColumn.getFilterValue() as string) ?? ""}
                            onChange={(event) =>
                                filterableColumn.setFilterValue(event.target.value)
                            }
                            className="w-full sm:max-w-sm"
                        />
                    </div>
                </div>
            )}

            {/* Desktop / tablet: the table. Hidden below md, where it would only scroll sideways. */}
            <div data-testid="data-table-desktop" className="hidden md:block rounded-md border overflow-x-auto -mx-2 px-2 sm:mx-0 sm:px-0">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((headerGroup) => (
                            <TableRow key={headerGroup.id}>
                                {headerGroup.headers.map((header) => {
                                    return (
                                        <TableHead key={header.id} className="whitespace-nowrap">
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                        </TableHead>
                                    )
                                })}
                            </TableRow>
                        ))}
                    </TableHeader>
                    <TableBody>
                        {rows?.length ? (
                            rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    tabIndex={onRowClick ? 0 : undefined}
                                    className={onRowClick ? "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" : undefined}
                                    onClick={(event) => {
                                        if (!isInteractiveTarget(event.target)) {
                                            activateRow(row.original)
                                        }
                                    }}
                                    onKeyDown={(event) => {
                                        if (onRowClick && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                            event.preventDefault()
                                            activateRow(row.original)
                                        }
                                    }}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="whitespace-nowrap">
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell
                                    colSpan={columns.length}
                                    className="h-24 text-center"
                                >
                                    {t("noResults")}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/*
              On a phone each record is a readable card: the first column is the record identity
              (its own full-width row, emphasised), and the remaining fields sit in a compact
              TWO-column grid instead of one labelled field per line. A seven-column table stacked
              one field per line produced a card taller than the phone for a single record; two
              columns halves it while keeping every label attached to its value. A field that is
              genuinely too wide for half (a row of chips, a progress rail) opts into the full row
              with `meta.mobileSpan = "full"`.
            */}
            <div data-testid="data-table-mobile" className="space-y-3 md:hidden">
                {rows?.length ? (
                    rows.map((row) => {
                        const cells = row
                            .getVisibleCells()
                            .filter((cell) => !readColumnMeta(cell.column.columnDef).mobileHidden)
                        const actionCells = cells.filter((cell) => cell.column.id === "actions")
                        const detailCells = cells.filter((cell) => cell.column.id !== "actions")
                        const [identityCell, ...restCells] = detailCells
                        const identityLabel = identityCell ? mobileLabelFor(identityCell.column.columnDef) : undefined
                        return (
                            <div
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                                tabIndex={onRowClick ? 0 : undefined}
                                className={cn(
                                    "data-table-mobile-card min-w-0 space-y-3 rounded-xl border bg-card p-4 shadow-sm",
                                    onRowClick &&
                                        "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                )}
                                onClick={(event) => {
                                    if (!isInteractiveTarget(event.target)) {
                                        activateRow(row.original)
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (onRowClick && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                                        event.preventDefault()
                                        activateRow(row.original)
                                    }
                                }}
                            >
                                {identityCell ? (
                                    <div className="min-w-0 border-b pb-3">
                                        {identityLabel ? (
                                            <span className="mb-1 block text-xs font-medium text-muted-foreground">
                                                {identityLabel}
                                            </span>
                                        ) : null}
                                        <div className="min-w-0 break-words text-base font-semibold [overflow-wrap:anywhere]">
                                            {flexRender(identityCell.column.columnDef.cell, identityCell.getContext())}
                                        </div>
                                    </div>
                                ) : null}
                                {restCells.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                        {restCells.map((cell) => {
                                            const label = mobileLabelFor(cell.column.columnDef)
                                            const fullWidth = readColumnMeta(cell.column.columnDef).mobileSpan === "full"
                                            return (
                                                <div key={cell.id} className={cn("min-w-0", fullWidth && "col-span-2")}>
                                                    {label ? (
                                                        <span className="mb-1 block text-xs font-medium text-muted-foreground">
                                                            {label}
                                                        </span>
                                                    ) : null}
                                                    <div className="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
                                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : null}
                                {actionCells.length > 0 && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 border-t pt-3">
                                    {actionCells.map((cell) => <div key={cell.id} className="min-w-0">{flexRender(cell.column.columnDef.cell, cell.getContext())}</div>)}
                                </div>}
                            </div>
                        )
                    })
                ) : (
                    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                        {t("noResults")}
                    </div>
                )}
            </div>

            {table.getPageCount() > 1 && <div className="flex items-center justify-end gap-3 py-4">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        {t("previous")}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        {t("next")}
                    </Button>
                </div>
            </div>}
        </div>
    )
}
