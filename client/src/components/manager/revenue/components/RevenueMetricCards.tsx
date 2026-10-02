import { mt } from "@/i18n/manager";
import { formatCurrency } from "@/lib/formatters";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { RevenueByDate, RevenueMetrics } from "../types";

interface Props {
  data?: RevenueByDate[];
  metrics?: RevenueMetrics | null;
  isLoading: boolean;
}

/** Period activity from the manager's earnings ledger. */
export function RevenueMetricCards({ data, metrics, isLoading }: Props) {
  if (isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)}</div>;
  if (!data && !metrics) return null;

  const earnings = data
    ? data.reduce((sum, day) => sum + day.managerRevenue, 0)
    : (metrics?.completedNetRevenue ?? metrics?.netRevenue ?? 0);
  const paidBookings = data
    ? data.reduce((sum, day) => sum + day.bookingCount, 0)
    : (metrics?.paidBookingCount ?? 0);
  const paymentEarnings = data?.reduce((sum, day) => sum + (day.paidEarnings ?? day.managerRevenue), 0)
    ?? (metrics?.completedNetRevenue ?? metrics?.netRevenue ?? 0);
  const refundsIssued = data?.reduce((sum, day) => sum + (day.refundedAmount ?? 0), 0) ?? metrics?.refundedAmount ?? 0;

  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <Card className="rounded-2xl border-border/70"><CardContent className="p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("revenueNetActivity")}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatCurrency(earnings)}</p>
      <p className="mt-2 truncate text-xs text-muted-foreground" title={mt("revenueNetActivityBody")}>{mt("revenueNetActivityBody")}</p>
    </CardContent></Card>
    <Card className="rounded-2xl border-border/70"><CardContent className="p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("revenuePaidPayments")}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{paidBookings}</p>
      <p className="mt-2 truncate text-xs text-muted-foreground" title={mt("revenuePaidPaymentsBody")}>{mt("revenuePaidPaymentsBody")}</p>
    </CardContent></Card>
    <Card className="rounded-2xl border-border/70"><CardContent className="p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("revenueAverageEarnings")}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatCurrency(paidBookings ? Math.round(paymentEarnings / paidBookings) : 0)}</p>
      <p className="mt-2 truncate text-xs text-muted-foreground" title={mt("revenueAverageEarningsBody")}>{mt("revenueAverageEarningsBody")}</p>
    </CardContent></Card>
    <Card className="rounded-2xl border-border/70"><CardContent className="p-5 md:p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{mt("revenueRefundsIssued")}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatCurrency(refundsIssued)}</p>
      <p className="mt-2 text-xs text-muted-foreground">{mt("revenueRefundsIssuedBody")}</p>
    </CardContent></Card>
  </div>;
}
