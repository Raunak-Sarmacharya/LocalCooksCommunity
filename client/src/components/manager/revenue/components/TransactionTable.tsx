/**
 * Transaction Table Component
 * 
 * Enterprise-grade transaction table using TanStack Table with DataTable.
 * Includes filtering, sorting, pagination, and CSV export.
 */

import { useState, useMemo, useCallback } from "react"
import {
    ColumnFiltersState,
    SortingState,
    VisibilityState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table"
import { Search, Download, ChevronDown, Receipt, FileSpreadsheet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
    DropdownMenuItem,
    DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { getTransactionColumns } from "../columns"
import { formatCurrency, transactionsToCSV, downloadCSV } from "@/lib/formatters"
import type { Transaction, PaymentStatus } from "../types"

interface TransactionTableProps {
    transactions: Transaction[]
    isLoading: boolean
    onDownloadInvoice: (bookingId: number) => void
    onViewDetails?: (transaction: Transaction) => void
}

export function TransactionTable({
    transactions,
    isLoading,
    onDownloadInvoice,
    onViewDetails,
}: TransactionTableProps) {
    const [sorting, setSorting] = useState<SortingState>([])
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
    const [globalFilter, setGlobalFilter] = useState('')
    const [paymentStatusFilter, setPaymentStatusFilter] = useState<PaymentStatus | 'all'>('all')

    const columns = useMemo(
        () => getTransactionColumns({ onDownloadInvoice, onViewDetails }),
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
                t.paymentIntentId?.toLowerCase().includes(query)
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
            (acc, t) => ({
                totalPrice: acc.totalPrice + (t.totalPrice || 0),
                taxAmount: acc.taxAmount + (t.taxAmount || 0),
                stripeFee: acc.stripeFee + (t.stripeFee || 0),
                netRevenue: acc.netRevenue + (t.netRevenue || 0),
            }),
            { totalPrice: 0, taxAmount: 0, stripeFee: 0, netRevenue: 0 }
        )
    }, [filteredData])

    // Export handlers
    const handleExportFiltered = useCallback(() => {
        const csv = transactionsToCSV(filteredData)
        downloadCSV(csv, `transactions-${new Date().toISOString().split('T')[0]}`)
    }, [filteredData])

    const handleExportAll = useCallback(() => {
        const csv = transactionsToCSV(transactions)
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
                        <div className="p-1.5 bg-rose-100 rounded-lg">
                            <Receipt className="h-4 w-4 text-rose-600" />
                        </div>
                        <div>
                            <CardTitle className="text-base">Transaction History</CardTitle>
                            <p className="text-xs text-muted-foreground">All booking transactions</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        {/* Payment Status Filter */}
                        <Select
                            value={paymentStatusFilter}
                            onValueChange={(value) => setPaymentStatusFilter(value as PaymentStatus | 'all')}
                        >
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="All Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Status</SelectItem>
                                <SelectItem value="paid">Paid</SelectItem>
                                <SelectItem value="processing">Processing</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="failed">Failed</SelectItem>
                                <SelectItem value="refunded">Refunded</SelectItem>
                            </SelectContent>
                        </Select>

                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="text"
                                placeholder="Search..."
                                value={globalFilter}
                                onChange={(e) => setGlobalFilter(e.target.value)}
                                className="pl-9 w-[180px]"
                            />
                        </div>

                        {/* Export Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="sm" className="gap-2">
                                    <FileSpreadsheet className="h-4 w-4" />
                                    Export
                                    <ChevronDown className="h-3 w-3" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Export to CSV</DropdownMenuLabel>
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
                                <Button variant="outline" size="sm">
                                    Columns <ChevronDown className="ml-2 h-3 w-3" />
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
                        <p className="text-muted-foreground">No transactions found</p>
                        <p className="text-sm text-muted-foreground/70 mt-1">
                            Transactions will appear here after bookings
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    {table.getHeaderGroups().map((headerGroup) => (
                                        <TableRow key={headerGroup.id}>
                                            {headerGroup.headers.map((header) => (
                                                <TableHead key={header.id}>
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
                                                <TableCell key={cell.id}>
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
                                        <TableCell colSpan={3}>
                                            Total ({filteredData.length} transactions)
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {formatCurrency(totals.totalPrice)}
                                        </TableCell>
                                        <TableCell className="text-right text-amber-600">
                                            {formatCurrency(totals.taxAmount)}
                                        </TableCell>
                                        <TableCell className="text-right text-violet-600">
                                            {formatCurrency(totals.stripeFee)}
                                        </TableCell>
                                        <TableCell className="text-right text-primary">
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
                                Showing {table.getRowModel().rows.length} of {filteredData.length} transactions
                            </div>
                            <div className="space-x-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => table.previousPage()}
                                    disabled={!table.getCanPreviousPage()}
                                >
                                    Previous
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => table.nextPage()}
                                    disabled={!table.getCanNextPage()}
                                >
                                    Next
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}
