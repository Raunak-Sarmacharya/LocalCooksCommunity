import React, { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Legend,
  Brush,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MAX_WEEKLY_BARS = 12;

interface MatrixData {
  period: string;
  gross_sales: number;
  earnings: number;
  orders: number;
  tips: number;
  commission: number;
  stripe_fee?: number;
}

interface ChefRevenueMatrixProps {
  data?: {
    weekly: MatrixData[];
    monthly: MatrixData[];
  };
  period?: string;
}

export function ChefRevenueMatrix({ data, period }: ChefRevenueMatrixProps) {
  const [view, setView] = useState<"weekly" | "monthly">("monthly");
  // windowStart: index into formattedData where the visible 12-bar window begins
  const [windowStart, setWindowStart] = useState<number>(0);

  React.useEffect(() => {
    if (period === "week" || period === "today") {
      setView("weekly");
    } else if (period === "month" || period === "all") {
      setView("monthly");
    }
  }, [period]);

  // ── Raw chart data (all periods, no windowing here) ──────────────────────────
  const chartData = useMemo(() => {
    if (!data) return [];
    const baseData = view === "weekly" ? data.weekly : data.monthly;
    if (!baseData) return [];

    if (period === "today" || period === "week") return baseData.slice(-1);
    if (period === "month") {
      return view === "weekly" ? baseData.slice(-4) : baseData.slice(-1);
    }
    return baseData;
  }, [data, view, period]);

  // ── Formatted data (labels, tooltips, derived values) ────────────────────────
  const formattedData = useMemo(() => {
    const getWeekLabels = (yearNum: number, weekNum: number) => {
      const jan4 = new Date(yearNum, 0, 4);
      const start = new Date(jan4);
      const dayOfWeek = start.getDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      start.setDate(jan4.getDate() - diffToMonday);
      start.setDate(start.getDate() + (weekNum - 1) * 7);

      const end = new Date(start);
      end.setDate(start.getDate() + 6);

      const startMonth = start.toLocaleDateString("en-US", { month: "short" });
      const endMonth = end.toLocaleDateString("en-US", { month: "short" });
      const startDay = start.getDate();
      const endDay = end.getDate();

      const dateLabel =
        startMonth === endMonth
          ? `${startMonth} ${startDay}–${endDay}`
          : `${startMonth} ${startDay}–${endMonth} ${endDay}`;

      const shortLabel = `Week ${weekNum}||${dateLabel}`;
      const fullLabel =
        startMonth === endMonth
          ? `Week ${weekNum}: ${startMonth} ${startDay}–${endDay}, ${yearNum}`
          : `Week ${weekNum}: ${startMonth} ${startDay}–${endMonth} ${endDay}, ${yearNum}`;

      return { shortLabel, fullLabel };
    };

    return chartData.map((item) => {
      let formattedPeriod = item.period;
      let tooltipLabel = item.period;

      if (view === "monthly") {
        const [year, month] = item.period.split("-");
        if (year && month) {
          const date = new Date(parseInt(year), parseInt(month) - 1);
          formattedPeriod = date.toLocaleString("en-US", { month: "short", year: "numeric" });
          tooltipLabel = formattedPeriod;
        }
      } else {
        const [yearStr, weekStr] = item.period.split("-");
        if (yearStr && weekStr) {
          const week = weekStr.replace("W", "");
          const labels = getWeekLabels(parseInt(yearStr), parseInt(week));
          formattedPeriod = labels.shortLabel;
          tooltipLabel = labels.fullLabel;
        }
      }

      const deductions =
        (item.stripe_fee ?? 0) || (item.gross_sales || 0) - (item.earnings || 0);
      const base_earnings = Math.max(0, (item.earnings || 0) - (item.tips || 0));

      return {
        ...item,
        formattedPeriod,
        tooltipLabel,
        deductions: Math.max(0, deductions),
        base_earnings,
      };
    });
  }, [chartData, view]);

  // ── Weekly window navigation ─────────────────────────────────────────────────
  const needsWindow = view === "weekly" && formattedData.length > MAX_WEEKLY_BARS;

  // Clamp and reset window when dataset or view changes
  const clampedWindowStart = useMemo(() => {
    const maxStart = Math.max(0, formattedData.length - MAX_WEEKLY_BARS);
    return Math.min(windowStart, maxStart);
  }, [windowStart, formattedData.length]);

  React.useEffect(() => {
    if (view === "weekly") {
      // Always start on the newest 12 when switching to weekly or data loads
      setWindowStart(Math.max(0, formattedData.length - MAX_WEEKLY_BARS));
    }
  }, [view, formattedData.length]);

  const canGoBack = clampedWindowStart > 0;
  const canGoForward =
    clampedWindowStart + MAX_WEEKLY_BARS < formattedData.length;

  const goBack = () =>
    setWindowStart((s) => Math.max(0, s - MAX_WEEKLY_BARS));
  const goForward = () =>
    setWindowStart((s) =>
      Math.min(formattedData.length - MAX_WEEKLY_BARS, s + MAX_WEEKLY_BARS)
    );

  // The data slice that actually goes into the chart
  const displayData = useMemo(() => {
    if (!needsWindow) return formattedData;
    return formattedData.slice(
      clampedWindowStart,
      clampedWindowStart + MAX_WEEKLY_BARS
    );
  }, [formattedData, needsWindow, clampedWindowStart]);

  if (!data || (!data.weekly?.length && !data.monthly?.length)) return null;

  // ── Range label ──────────────────────────────────────────────────────────────
  const rangeLabel = useMemo(() => {
    if (!needsWindow || displayData.length === 0) return null;
    const first = displayData[0]?.formattedPeriod?.split("||")[0] ?? "";
    const last =
      displayData[displayData.length - 1]?.formattedPeriod?.split("||")[0] ?? "";
    return `${first} – ${last}`;
  }, [needsWindow, displayData]);

  const chartConfig = {
    gross_sales: { label: "Gross Sales", color: "hsl(var(--chart-1))" },
    base_earnings: { label: "Base Earnings", color: "hsl(var(--chart-2))" },
    tips: { label: "Tips", color: "hsl(var(--chart-3))" },
    deductions: { label: "Stripe & Fees", color: "hsl(var(--destructive))" },
  };

  return (
    <Card className="mb-8 overflow-hidden border shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 gap-4">
        <div>
          <CardTitle className="text-xl font-bold">Revenue Metrics</CardTitle>
          <CardDescription>Analyze your sales and earnings over time</CardDescription>
        </div>
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as "weekly" | "monthly")}
          className="w-full sm:w-[200px]"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {displayData.length > 0 ? (
          <>
            {/* Weekly navigation bar */}
            {needsWindow && (
              <div className="flex items-center justify-between mb-3 px-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goBack}
                  disabled={!canGoBack}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Older
                </Button>
                <span className="text-xs text-muted-foreground font-medium">
                  {rangeLabel}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goForward}
                  disabled={!canGoForward}
                  className="h-7 px-2 gap-1 text-xs"
                >
                  Newer
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div
              className={
                view === "weekly" ? "h-[380px] w-full" : "h-[350px] w-full mt-4"
              }
            >
              <ChartContainer config={chartConfig} className="h-full w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={displayData}
                    margin={{
                      top: 10,
                      right: 60,
                      left: 0,
                      bottom: view === "weekly" ? 20 : 0,
                    }}
                  >
                    <defs>
                      <pattern
                        id="deductions-pattern"
                        width="6"
                        height="6"
                        patternUnits="userSpaceOnUse"
                        patternTransform="rotate(45)"
                      >
                        <rect
                          width="6"
                          height="6"
                          fill="var(--color-deductions)"
                          fillOpacity="0.1"
                        />
                        <path
                          d="M0,0 L0,6"
                          stroke="var(--color-deductions)"
                          strokeWidth="1.5"
                          opacity="0.6"
                        />
                      </pattern>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="hsl(var(--muted-foreground)/0.2)"
                    />
                    <XAxis
                      dataKey="formattedPeriod"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      height={view === "weekly" ? 52 : 40}
                      tick={(props: any) => {
                        const { x, y, payload } = props;
                        const parts = (payload.value || "").split("||");
                        if (parts.length === 2) {
                          return (
                            <g transform={`translate(${x},${y})`}>
                              <text
                                x={0}
                                y={12}
                                textAnchor="middle"
                                fill="hsl(var(--foreground))"
                                fontSize={11}
                                fontWeight={600}
                              >
                                {parts[0]}
                              </text>
                              <text
                                x={0}
                                y={27}
                                textAnchor="middle"
                                fill="hsl(var(--muted-foreground))"
                                fontSize={10}
                              >
                                {parts[1]}
                              </text>
                            </g>
                          );
                        }
                        return (
                          <g transform={`translate(${x},${y})`}>
                            <text
                              x={0}
                              y={15}
                              textAnchor="middle"
                              fill="hsl(var(--muted-foreground))"
                              fontSize={12}
                            >
                              {payload.value}
                            </text>
                          </g>
                        );
                      }}
                    />
                    <YAxis
                      width={60}
                      tickFormatter={(value) => `$${value}`}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          indicator="dot"
                          labelFormatter={(value, payload) =>
                            payload?.[0]?.payload?.tooltipLabel ||
                            String(value).replace("||", " – ")
                          }
                        />
                      }
                      cursor={{ fill: "hsl(var(--muted)/0.1)" }}
                    />
                    <Legend wrapperStyle={{ paddingTop: "20px" }} />
                    <Bar
                      dataKey="base_earnings"
                      name="Base Earnings"
                      stackId="revenue"
                      fill="var(--color-base_earnings)"
                    />
                    <Bar
                      dataKey="tips"
                      name="Tips"
                      stackId="revenue"
                      fill="var(--color-tips)"
                    />
                    <Bar
                      dataKey="deductions"
                      name="Stripe & Fees"
                      stackId="revenue"
                      fill="url(#deductions-pattern)"
                      stroke="var(--color-deductions)"
                      strokeWidth={1}
                      radius={[4, 4, 0, 0]}
                    />
                    {/* Monthly brush for long histories */}
                    {view === "monthly" && formattedData.length > 6 && (
                      <Brush
                        dataKey="formattedPeriod"
                        height={24}
                        stroke="hsl(var(--muted-foreground)/0.4)"
                        fill="hsl(var(--muted)/0.2)"
                        tickFormatter={(value) => String(value).split("||")[0]}
                        startIndex={Math.max(0, formattedData.length - 12)}
                        travellerWidth={10}
                        traveller={(props: any) => {
                          const { x, y, width, height } = props;
                          return (
                            <g
                              transform={`translate(${x},${y})`}
                              style={{ cursor: "ew-resize" }}
                            >
                              <rect width={width} height={height} fill="transparent" />
                              <rect
                                x={width / 2 - 2}
                                y={4}
                                width={4}
                                height={height - 8}
                                rx={2}
                                fill="hsl(var(--primary))"
                              />
                            </g>
                          );
                        }}
                      />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground border border-dashed rounded-lg">
            No data available for this view
          </div>
        )}
      </CardContent>
    </Card>
  );
}
