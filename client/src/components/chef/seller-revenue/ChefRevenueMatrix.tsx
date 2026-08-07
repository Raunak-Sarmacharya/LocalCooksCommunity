import React, { useState, useMemo } from "react";
import { 
  BarChart, 
  Bar,
  CartesianGrid, 
  XAxis, 
  YAxis, 
  ResponsiveContainer,
  Legend
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

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

  React.useEffect(() => {
    if (period === 'week' || period === 'today') {
      setView('weekly');
    } else if (period === 'month' || period === 'all') {
      setView('monthly');
    }
  }, [period]);

  const chartData = useMemo(() => {
    if (!data) return [];
    const baseData = view === "weekly" ? data.weekly : data.monthly;
    if (!baseData) return [];

    if (period === 'today' || period === 'week') {
      return baseData.slice(-1);
    } else if (period === 'month') {
      return view === "weekly" ? baseData.slice(-4) : baseData.slice(-1);
    }
    
    return baseData;
  }, [data, view, period]);

  // Format the period string to be more readable
  const formattedData = useMemo(() => {
    return chartData.map(item => {
      let formattedPeriod = item.period;
      if (view === "monthly") {
        // "2026-04" -> "Apr 2026"
        const [year, month] = item.period.split("-");
        if (year && month) {
          const date = new Date(parseInt(year), parseInt(month) - 1);
          formattedPeriod = date.toLocaleString("en-US", { month: "short", year: "numeric" });
        }
      } else {
        // "2026-W14" -> "Week 14, 2026"
        const [year, weekStr] = item.period.split("-");
        if (year && weekStr) {
          const week = weekStr.replace("W", "");
          formattedPeriod = `Week ${week}, ${year}`;
        }
      }
      
      const deductions = (item.stripe_fee ?? 0) || ((item.gross_sales || 0) - (item.earnings || 0));
      const base_earnings = Math.max(0, (item.earnings || 0) - (item.tips || 0));
      
      return {
        ...item,
        formattedPeriod,
        deductions: Math.max(0, deductions),
        base_earnings,
      };
    });
  }, [chartData, view]);

  if (!data || (!data.weekly?.length && !data.monthly?.length)) {
    return null;
  }

  const chartConfig = {
    gross_sales: {
      label: "Gross Sales",
      color: "hsl(var(--chart-1))",
    },
    base_earnings: {
      label: "Base Earnings",
      color: "hsl(var(--chart-2))",
    },
    tips: {
      label: "Tips",
      color: "hsl(var(--chart-3))",
    },
    deductions: {
      label: "Stripe & Fees",
      color: "hsl(var(--destructive))",
    }
  };

  return (
    <Card className="mb-8 overflow-hidden border shadow-sm">
      <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 gap-4">
        <div>
          <CardTitle className="text-xl font-bold">Revenue Metrics</CardTitle>
          <CardDescription>Analyze your sales and earnings over time</CardDescription>
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as "weekly" | "monthly")} className="w-full sm:w-[200px]">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {formattedData.length > 0 ? (
          <div className="h-[350px] w-full mt-4">
            <ChartContainer config={chartConfig} className="h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={formattedData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground)/0.2)" />
                  <XAxis 
                    dataKey="formattedPeriod" 
                    tickLine={false} 
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis 
                    width={60}
                    tickFormatter={(value) => `$${value}`} 
                    tickLine={false} 
                    axisLine={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  />
                  <ChartTooltip 
                    content={<ChartTooltipContent indicator="dot" />}
                    cursor={{ fill: "hsl(var(--muted)/0.1)" }}
                  />
                  <Legend wrapperStyle={{ paddingTop: "20px" }} />
                  <Bar dataKey="base_earnings" name="Base Earnings" stackId="revenue" fill="var(--color-base_earnings)" />
                  <Bar dataKey="tips" name="Tips" stackId="revenue" fill="var(--color-tips)" />
                  <Bar dataKey="deductions" name="Stripe & Fees" stackId="revenue" fill="var(--color-deductions)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </div>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground border border-dashed rounded-lg">
            No data available for this view
          </div>
        )}
      </CardContent>
    </Card>
  );
}
