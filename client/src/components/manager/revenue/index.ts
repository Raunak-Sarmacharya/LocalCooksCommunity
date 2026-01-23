/**
 * Revenue Dashboard Index
 * 
 * Barrel export for revenue dashboard components.
 */

// Types
export * from './types'

// Columns
export { getTransactionColumns, getInvoiceColumns, getPayoutColumns } from './columns'

// Hooks
export {
    useRevenueMetrics,
    useRevenueByLocation,
    useRevenueChartData,
    useTransactions,
    useInvoices,
    usePayouts,
    useStripeConnectStatus,
    downloadInvoice,
    downloadPayoutStatement,
    getDefaultDateRange,
} from './hooks/use-revenue-data'

// Components
export { RevenueMetricCards } from './components/RevenueMetricCards'
export { TransactionTable } from './components/TransactionTable'
export { DateRangePicker } from './components/DateRangePicker'
export {
    RevenueTrendChart,
    RevenueByLocationChart,
    PaymentStatusChart,
} from './components/RevenueCharts'
