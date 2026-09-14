/**
 * Transaction Table Component
 * 
 * Enterprise-grade transaction table using TanStack Table with DataTable.
 * Includes filtering, sorting, pagination, and CSV export.
 */

import { useState, useMemo, useCallback } from "react"
import { mt } from "@/i18n/manager"
import { ColumnFiltersState, SortingState, VisibilityState, flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, useReactTable } from "@tanstack/react-table"
import { Search, Download, ChevronDown, Receipt, FileSpreadsheet } from "@/components/ui/manager-icons"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getTransactionColumns } from "../columns"
import { formatCurrency, downloadCSV } from "@/lib/formatters"
import type { Transaction, PaymentStatus } from "../types"
import { getTransactionRevenueBreakdown, transactionsToManagerRevenueCSV } from "../revenue-calculations"

interface TransactionTableProps {
    transactions: Transaction[]
    isLoading: boolean
    onDownloadInvoice: (bookingId: number, bookingType?: string, transactionId?: number) => void
    onViewDetails?: (transaction: Transaction) => void
}

export function TransactionTable({
    transactions,
    isLoading,
    onDownloadInvoice,
    onViewDetails,
}: TransactionTableProps) {
  
    const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }])
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({ createdAt: false })
    const [globalFilter, setGlobalFilter] = useState('')
    const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatus | 'all'>('all')
    const columns = useMemo(
        () => getTransactionColumns({
            onDownloadInvoice,
            onViewDetails,
        }),
        [onDownloadInvoice, onViewDetails]
    )

    // Filter transactions by search and payment status
    const filteredData = useMemo(() => {
        let data = transactions

        if (paymentStatusFilter !== 'all') {
            data = data.filter(t => t.paymentStatus === paymentStatusFilter)
        }

        if (globalFilter) {
            const query = globalFilter.toLowerCase()
            data = data.filter(t =>
                t.chefName?.toLowerCase().includes(query) ||
                t.kitchenName?.toLowerCase().includes(query) ||
                t.locationName?.toLowerCase().includes(query) ||
                t.paymentIntentId?.toLowerCase().includes(query) ||
                t.referenceCode?.toLowerCase().includes(query)
            )
        }

        return data
    }, [transactions, paymentStatusFilter, globalFilter])

    const table = useReactTable({
        data: filteredData,
        columns,
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        state: {
            sorting,
            columnFilters,
            columnVisibility,
        },
        initialState: {
            pagination: { pageSize: 10 },
        },
    })

    // Calculate totals for footer
    const totals = useMemo(() => {
        return filteredData.reduce(
            (acc, t) => {
                const breakdown = getTransactionRevenueBreakdown(t);

                return {
                    totalPrice: acc.totalPrice + breakdown.totalPrice,
                    taxAmount: acc.taxAmount + breakdown.taxAmount,
                    stripeFee: acc.stripeFee + breakdown.stripeFee,
                    refundAmount: acc.refundAmount + breakdown.refundAmount,
                    netRevenue: acc.netRevenue + breakdown.netRevenue,
                };
            },
            { totalPrice: 0, taxAmount: 0, stripeFee: 0, refundAmount: 0, netRevenue: 0 }
        )
    }, [filteredData])

    // Export handlers
    const handleExportFiltered = useCallback(() => {
        const csv = transactionsToManagerRevenueCSV(filteredData)
        downloadCSV(csv, `transactions-${new Date().toISOString().split('T')[0]}`)
    }, [filteredData])

    const handleExportAll = useCallback(() => {
        const csv = transactionsToManagerRevenueCSV(transactions)
        downloadCSV(csv, `all-transactions-${new Date().toISOString().split('T')[0]}`)
    }, [transactions])

    if (isLoading) {
        return (
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-8 rounded-lg" />
                        <div>
                            <Skeleton className="h-5 w-40" />
                            <Skeleton className="h-3 w-32 mt-1" />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {[...Array(5)].map((_, i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-rose-600" />
                        <div>
                            <CardTitle className="text-base">{mt("transactionHistory")}</CardTitle>
                            <p className="text-xs text-muted-foreground">{mt("allBookingTransactions")}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Payment Status Filter */}
                        <Select
                            value={paymentStatusFilter}
                            onValueChange={(value) => setPaymentStatusFilter(value as PaymentStatus | 'all')}
                        >
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder={mt("allStatus")} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">{mt("allStatus")}</SelectItem>
                                <SelectItem value="authorized">{mt("paymentHeld")}</SelectItem>
                                <SelectItem value="paid">{mt("paid")}</SelectItem>
                                <SelectItem value="processing">{mt("processing")}</SelectItem>
                                <SelectItem value="pending">{mt("pending")}</SelectItem>
                                <SelectItem value="canceled">{mt("canceled")}</SelectItem>
                                <SelectItem value="failed">{mt("failed")}</SelectItem>
                                <SelectItem value="refunded">{mt("refunded")}</SelectItem>
                                <SelectItem value="partially_refunded">{mt("partialRefund")}</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder={mt("shellSearch")}
                                value={globalFilter}
                                onChange={(e) => setGlobalFilter(e.target.value)}
                                className="pl-9 w-[180px]"
                            />
                        </div>

                        {/* Export Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-2">
                                    <FileSpreadsheet className="h-4 w-4" />{mt("export")}<ChevronDown className="h-3 w-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{mt("exportToCSV")}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={handleExportFiltered}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export Filtered ({filteredData.length} rows)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportAll}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export All ({transactions.length} rows)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Column Visibility */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm">{mt("columns")}<ChevronDown className="ml-2 h-3 w-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {table
                                    .getAllColumns()
                                    .filter((column) => column.getCanHide())
                                    .map((column) => (
                                        <DropdownMenuCheckboxItem
                                            key={column.id}
                                            className="capitalize"
                                            checked={column.getIsVisible()}
                                            onCheckedChange={(value) => column.toggleVisibility(!!value)}
                                        >
                                            {column.id}
                                        </DropdownMenuCheckboxItem>
                                    ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </CardHeader>

            <CardContent>
                {filteredData.length === 0 ? (
                    <div className="text-center py-12">
                        <Receipt className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                        <p className="text-muted-foreground">{mt("noTransactionsFound")}</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">{mt("transactionsWillAppearHereAfterBookings")}</p>
                    </div>
                ) : (
                    <>
                        <div className="rounded-md border overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                            <Table>
                                <TableHeader>
                                    {table.getHeaderGroups().map((headerGroup) => (
                                        <TableRow key={headerGroup.id}>
                                            {headerGroup.headers.map((header) => (
                                                <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm">
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                            header.column.columnDef.header,
                                                            header.getContext()
                                                        )}
                                                </TableHead>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableHeader>
                                <TableBody>
                                    {table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            data-state={row.getIsSelected() && "selected"}
                                        >
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id} className="text-xs sm:text-sm whitespace-nowrap">
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
                                                        cell.getContext()
                                                    )}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                    {/* Totals Row */}
                                    <TableRow className="bg-muted/50 font-semibold">
                                        <TableCell colSpan={4}>
                                            {mt("totalTransactionsCount", { count: filteredData.length })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(totals.totalPrice)}
                                        </TableCell>
                                        <TableCell className="text-right text-amber-600">
                                            {formatCurrency(totals.taxAmount)}
                                        </TableCell>
                                        <TableCell className="text-right text-stripe">
                                            {formatCurrency(totals.stripeFee)}
                                        </TableCell>
                                        <TableCell className="text-right text-red-600">
                                            {totals.refundAmount > 0 ? `-${formatCurrency(totals.refundAmount)}` : '—'}
                                        </TableCell>
                                        <TableCell className={`text-right font-bold ${totals.refundAmount > 0 ? 'text-orange-600' : 'text-primary'}`}>
                                            {formatCurrency(totals.netRevenue)}
                                        </TableCell>
                                        <TableCell colSpan={2} />
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>

                        {/* Pagination */}
                        <div className="flex items-center justify-between space-x-2 py-4">
                            <div className="text-sm text-muted-foreground">
                                {mt("showingTransactionsCount", { shown: table.getRowModel().rows.length, total: filteredData.length })}
                            </div>
                            <div className="space-x-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                >{mt("previous")}</Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                >{mt("next")}</Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
