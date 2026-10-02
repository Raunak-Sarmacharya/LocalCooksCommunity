import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { mt } from "@/i18n/manager";
import { centsToDollars, formatCurrency } from "@/lib/formatters";
import { TrendingUp } from "@/components/ui/manager-icons";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { buildEarningsBuckets, type EarningsBucket } from "../earnings-chart";
import type { DateRange, RevenueByDate } from "../types";

const chartConfig = {
  netEarningsDollars: { label: mt("revenueNetActivity"), color: "#10b981" },
} satisfies ChartConfig;

interface Props {
  data: RevenueByDate[];
  dateRange: DateRange;
  isLoading: boolean;
}

export function RevenueTrendChart({ data, dateRange, isLoading }: Props) {
  const chartData = useMemo(() => dateRange.from && dateRange.to
    ? buildEarningsBuckets(data, dateRange.from, dateRange.to).map((bucket) => ({
        ...bucket,
        netEarningsDollars: centsToDollars(bucket.netEarnings),
      }))
    : [], [data, dateRange.from, dateRange.to]);
  const fromDay = dateRange.from ? Date.UTC(dateRange.from.getFullYear(), dateRange.from.getMonth(), dateRange.from.getDate()) : 0;
  const toDay = dateRange.to ? Date.UTC(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate()) : 0;
  const days = (toDay - fromDay) / 86_400_000 + 1;
  const shortDate = (time: number) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(time));
  const labelDate = (value: string) => {
    const time = Date.parse(`${value}T12:00:00Z`);
    if (days > 120) return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(time));
    if (days > 31) return `${shortDate(time)}–${shortDate(Math.min(time + 6 * 86_400_000, toDay + 12 * 60 * 60_000))}`;
    return shortDate(time);
  };

  return <Card className="rounded-2xl border-border/70">
    <CardHeader>
      <CardTitle>{mt("revenueEarningsActivity")}</CardTitle>
      <CardDescription>{mt("revenueTrendDescription")}</CardDescription>
    </CardHeader>
    <CardContent>
      {isLoading ? <Skeleton className="h-[260px] w-full rounded-xl" /> : data.length === 0 ? (
        <div className="flex h-[260px] flex-col items-center justify-center text-center">
          <TrendingUp className="mb-4 size-8 text-muted-foreground/40" />
          <p className="text-sm font-medium">{mt("revenueNoActivityTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{mt("revenueNoActivityBody")}</p>
        </div>
      ) : <>
        <ChartContainer config={chartConfig} className="h-[260px] w-full">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} tickFormatter={labelDate} />
            <YAxis tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(value) => `$${value}`} />
            <ReferenceLine y={0} stroke="hsl(var(--border))" />
            <ChartTooltip cursor={false} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as EarningsBucket;
              return <div className="min-w-48 rounded-xl border bg-background p-3 text-xs shadow-lg">
                <p className="mb-2 font-semibold">{labelDate(point.date)}</p>
                <p className="flex justify-between gap-5 text-muted-foreground"><span>{mt("revenueNetActivity")}</span><strong className="text-foreground">{formatCurrency(point.netEarnings)}</strong></p>
              </div>;
            }} />
            <Bar dataKey="netEarningsDollars" radius={3} maxBarSize={36}>
              {chartData.map((point) => <Cell key={point.date} fill={point.netEarnings < 0 ? "#e11d48" : "#10b981"} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
      </>}
    </CardContent>
  </Card>;
}
