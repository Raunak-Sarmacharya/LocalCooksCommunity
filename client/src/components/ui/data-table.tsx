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

    return (
        <div className="w-full space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center py-2 sm:py-4 w-full sm:w-auto">
                    <Input
                        placeholder={resolvedFilterPlaceholder}
                        value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
                        onChange={(event) =>
                            table.getColumn(filterColumn)?.setFilterValue(event.target.value)
                        }
                        className="w-full sm:max-w-sm"
                    />
                </div>
            </div>

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

            {/* Mobile: one card per row, label/value pairs. A data table cannot be read at 375px. */}
            <div data-testid="data-table-mobile" className="md:hidden space-y-4">
                {rows?.length ? (
                    rows.map((row) => {
                        const cells = row
                            .getVisibleCells()
                            .filter((cell) => !readColumnMeta(cell.column.columnDef).mobileHidden)
                        return (
                            <div
                                key={row.id}
                                data-state={row.getIsSelected() && "selected"}
                                tabIndex={onRowClick ? 0 : undefined}
                                className={cn(
                                    "rounded-lg border bg-card p-4 space-y-3",
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
                                {cells.map((cell) => {
                                    const label = mobileLabelFor(cell.column.columnDef)
                                    return (
                                        <div key={cell.id} className="flex items-start justify-between gap-3">
                                            {label ? (
                                                <span className="shrink-0 text-sm font-medium text-muted-foreground">
                                                    {label}
                                                </span>
                                            ) : null}
                                            <span className="min-w-0 flex-1 text-sm text-right">
                                                {flexRender(
                                                    cell.column.columnDef.cell,
                                                    cell.getContext()
                                                )}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })
                ) : (
                    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
                        {t("noResults")}
                    </div>
                )}
            </div>

            <div className="flex items-center justify-end gap-3 py-4">
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
            </div>
        </div>
    )
}
