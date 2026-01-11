import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import {
  Calendar,
  Clock,
  TrendingUp,
  TrendingDown,
  Users,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  ChefHat,
  Settings,
  FileText,
  Eye,
  MessageSquare,
  Percent,
  CalendarDays,
  BarChart3,
  Bell,
  Zap,
  Search,
  Mail,
  Phone,
  Star,
  Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import BookingCalendarWidget from "./BookingCalendarWidget";

// ═══════════════════════════════════════════════════════════════════════════════
// KITCHEN DASHBOARD OVERVIEW - Award-Winning Design
// Inspired by Peerspace, Splacer, Airbnb, and top booking platforms
// ═══════════════════════════════════════════════════════════════════════════════

type ViewType = 'overview' | 'bookings' | 'availability' | 'settings' | 'applications' | 'pricing' | 'storage-listings' | 'equipment-listings' | 'revenue';

interface Location {
  id: number;
  name: string;
  address: string;
}

interface KitchenDashboardOverviewProps {
  selectedLocation: Location | null;
  onNavigate: (view: ViewType) => void;
}

// Helper function to get auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

export default function KitchenDashboardOverview({ 
  selectedLocation, 
  onNavigate 
}: KitchenDashboardOverviewProps) {
  // Get Firebase user for authentication
  const { user: firebaseUser } = useFirebaseAuth();
  
  // Fetch all bookings for this manager
  const { data: bookings = [], isLoading: isLoadingBookings } = useQuery({
    queryKey: ['managerBookings', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) {
        throw new Error('Not authenticated');
      }
      
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error('Not authenticated');
      }
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
      
      const response = await fetch('/api/manager/bookings', {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch bookings');
      }
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return [];
    },
    enabled: !!firebaseUser,
    refetchInterval: 10000, // Real-time updates
    refetchOnWindowFocus: true,
  });

  // Fetch chef kitchen applications for this manager
  const { data: applications = [], isLoading: isLoadingApplications } = useQuery({
    queryKey: ['managerKitchenApplications', firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) {
        throw new Error('Not authenticated');
      }
      
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error('Not authenticated');
      }
      const token = await currentFirebaseUser.getIdToken();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
      
      const response = await fetch('/api/manager/kitchen-applications', {
        headers,
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch applications');
      }
      
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json();
      }
      return [];
    },
    enabled: !!firebaseUser,
    refetchInterval: 10000, // Real-time updates
    refetchOnWindowFocus: true,
  });

  // Fetch revenue metrics for this month
  const { data: revenueMetrics, isLoading: isLoadingRevenue } = useQuery({
    queryKey: ['/api/manager/revenue/overview', 'this-month', selectedLocation?.id],
    queryFn: async () => {
      if (!firebaseUser) {
        throw new Error('Not authenticated');
      }
      
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) {
        throw new Error('Not authenticated');
      }
      const token = await currentFirebaseUser.getIdToken();
      
      // Calculate this month's date range
      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      
      const params = new URLSearchParams({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      });
      
      // Add location filter if a specific location is selected
      if (selectedLocation && selectedLocation.id) {
        params.append('locationId', selectedLocation.id.toString());
      }
      
      const response = await fetch(`/api/manager/revenue/overview?${params}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        credentials: "include",
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch revenue metrics');
      }
      
      return response.json();
    },
    enabled: !!firebaseUser,
    refetchInterval: 30000, // Refresh every 30 seconds
    refetchOnWindowFocus: true,
  });

  // Calculate dashboard metrics
  const dashboardMetrics = useMemo(() => {
    // Helper function to normalize date to YYYY-MM-DD in local timezone
    const normalizeDate = (date: Date | string): string => {
      const d = typeof date === 'string' ? new Date(date) : date;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = normalizeDate(today);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    weekFromNow.setHours(23, 59, 59, 999);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

    // Filter bookings by date
    const todayBookings = bookings.filter((b: any) => {
      if (!b.bookingDate) return false;
      const bookingDateStr = normalizeDate(b.bookingDate);
      return bookingDateStr === todayStr && b.status !== 'cancelled';
    });

    const weekBookings = bookings.filter((b: any) => {
      if (!b.bookingDate) return false;
      const bookingDate = new Date(b.bookingDate);
      bookingDate.setHours(0, 0, 0, 0);
      return bookingDate >= today && bookingDate <= weekFromNow && b.status !== 'cancelled';
    });

    const pendingBookings = bookings.filter((b: any) => b.status === 'pending');
    const confirmedBookings = bookings.filter((b: any) => b.status === 'confirmed');
    const cancelledBookings = bookings.filter((b: any) => b.status === 'cancelled');

    // This month's bookings
    const thisMonthBookings = bookings.filter((b: any) => {
      if (!b.bookingDate) return false;
      const bookingDate = new Date(b.bookingDate);
      bookingDate.setHours(0, 0, 0, 0);
      return bookingDate >= startOfMonth && b.status === 'confirmed';
    });

    // Last month's bookings (for comparison)
    const lastMonthBookings = bookings.filter((b: any) => {
      if (!b.bookingDate) return false;
      const bookingDate = new Date(b.bookingDate);
      bookingDate.setHours(0, 0, 0, 0);
      return bookingDate >= lastMonthStart && bookingDate <= lastMonthEnd && b.status === 'confirmed';
    });

    // Calculate trend
    const thisMonthCount = thisMonthBookings.length;
    const lastMonthCount = lastMonthBookings.length || 1; // Avoid division by zero
    const bookingTrend = ((thisMonthCount - lastMonthCount) / lastMonthCount) * 100;

    // Unique chefs this month
    const uniqueChefs = new Set(
      thisMonthBookings.map((b: any) => b.chefId || b.userId || b.portalUserId).filter(Boolean)
    );

    // Calculate utilization (assuming 12 hours per day available)
    const availableHoursThisWeek = 7 * 12;
    const bookedHoursThisWeek = weekBookings.reduce((total: number, b: any) => {
      if (!b.startTime || !b.endTime) return total;
      const [startH] = b.startTime.split(':').map(Number);
      const [endH] = b.endTime.split(':').map(Number);
      return total + (endH - startH);
    }, 0);
    const utilizationRate = Math.round((bookedHoursThisWeek / availableHoursThisWeek) * 100);

    return {
      todayBookings: todayBookings.length,
      weekBookings: weekBookings.length,
      pendingBookings: pendingBookings.length,
      confirmedBookings: confirmedBookings.length,
      cancelledBookings: cancelledBookings.length,
      totalBookings: bookings.length,
      thisMonthBookings: thisMonthCount,
      bookingTrend: Math.round(bookingTrend),
      uniqueChefs: uniqueChefs.size,
      utilizationRate: Math.min(utilizationRate, 100),
    };
  }, [bookings]);

  // Generate chart data for weekly bookings (next 7 days including today)
  const weeklyChartData = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date();
    // Set to start of day in local timezone to avoid timezone issues
    today.setHours(0, 0, 0, 0);
    const data = [];

    // Helper function to normalize date to YYYY-MM-DD in local timezone
    const normalizeDate = (date: Date | string): string => {
      const d = typeof date === 'string' ? new Date(date) : date;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Get next 7 days (including today) to match "This Week" metric
    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dateStr = normalizeDate(date);
      
      const dayBookings = bookings.filter((b: any) => {
        if (!b.bookingDate) return false;
        const bookingDateStr = normalizeDate(b.bookingDate);
        return bookingDateStr === dateStr;
      });

      data.push({
        day: days[date.getDay()],
        date: date.getDate(),
        confirmed: dayBookings.filter((b: any) => b.status === 'confirmed').length,
        pending: dayBookings.filter((b: any) => b.status === 'pending').length,
        total: dayBookings.filter((b: any) => b.status !== 'cancelled').length,
      });
    }
    return data;
  }, [bookings]);

  // Get recent bookings for the table
  const recentBookings = useMemo(() => {
    return [...bookings]
      .sort((a: any, b: any) => new Date(b.createdAt || b.bookingDate).getTime() - new Date(a.createdAt || a.bookingDate).getTime())
      .slice(0, 5);
  }, [bookings]);

  // Get urgent actions
  const urgentActions = useMemo(() => {
    const actions: { type: 'danger' | 'warning' | 'info'; icon: any; title: string; count: number; action: ViewType }[] = [];
    
    if (dashboardMetrics.pendingBookings > 0) {
      actions.push({
        type: 'warning',
        icon: Clock,
        title: 'Pending Approvals',
        count: dashboardMetrics.pendingBookings,
        action: 'bookings'
      });
    }
    
    // Check for today's bookings
    if (dashboardMetrics.todayBookings > 0) {
      actions.push({
        type: 'info',
        icon: CalendarDays,
        title: "Today's Sessions",
        count: dashboardMetrics.todayBookings,
        action: 'bookings'
      });
    }

    return actions;
  }, [dashboardMetrics]);

  // Format time helper
  const formatTime = (time: string) => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
  };

  // Format date helper
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════════════════
          WELCOME HEADER
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Welcome back{selectedLocation ? `, ${selectedLocation.name}` : ''} 👋
          </h1>
          <p className="text-gray-500 mt-1">
            Here's what's happening with your kitchen today
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <CalendarDays className="h-4 w-4" />
          {new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          PRIMARY KPIs - Bento Style Layout (Symmetric)
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        {/* Row 1: Three Smaller Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {/* Today's Bookings */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/25 hover:shadow-xl hover:shadow-rose-500/30 transition-all duration-300 hover:-translate-y-1">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-rose-100 text-[10px] font-medium uppercase tracking-wider">Today</p>
                  <p className="text-2xl font-bold mt-1">{dashboardMetrics.todayBookings}</p>
                  <p className="text-rose-100 text-xs mt-1">Sessions scheduled</p>
                </div>
                <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                  <CalendarDays className="h-4 w-4" />
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
            </CardContent>
          </Card>

          {/* This Week */}
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-xl hover:shadow-violet-500/30 transition-all duration-300 hover:-translate-y-1">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-violet-100 text-[10px] font-medium uppercase tracking-wider">This Week</p>
                  <p className="text-2xl font-bold mt-1">{dashboardMetrics.weekBookings}</p>
                  <p className="text-violet-100 text-xs mt-1">Upcoming bookings</p>
                </div>
                <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                  <Calendar className="h-4 w-4" />
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
            </CardContent>
          </Card>

          {/* Pending Review */}
          <Card className={`relative overflow-hidden border-0 shadow-lg transition-all duration-300 hover:-translate-y-1 ${
            dashboardMetrics.pendingBookings > 0 
              ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30' 
              : 'bg-white border border-gray-100 text-gray-900 hover:shadow-xl'
          }`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-[10px] font-medium uppercase tracking-wider ${dashboardMetrics.pendingBookings > 0 ? 'text-amber-100' : 'text-gray-500'}`}>
                    Pending
                  </p>
                  <p className="text-2xl font-bold mt-1">{dashboardMetrics.pendingBookings}</p>
                  <p className={`text-xs mt-1 ${dashboardMetrics.pendingBookings > 0 ? 'text-amber-100' : 'text-gray-500'}`}>
                    Needs review
                  </p>
                </div>
                <div className={`p-1.5 rounded-lg ${dashboardMetrics.pendingBookings > 0 ? 'bg-white/20 backdrop-blur-sm' : 'bg-amber-100'}`}>
                  <Clock className={`h-4 w-4 ${dashboardMetrics.pendingBookings > 0 ? 'text-white' : 'text-amber-600'}`} />
                </div>
              </div>
              {dashboardMetrics.pendingBookings > 0 && (
                <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Two Larger Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Weekly Activity */}
          <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-100 rounded-lg">
                    <BarChart3 className="h-4 w-4 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-gray-700 text-sm font-semibold">Weekly Activity</p>
                    <p className="text-xs text-gray-500">Next 7 days</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">
                    {weeklyChartData.reduce((sum, day) => sum + day.total, 0)}
                  </p>
                  <p className="text-[10px] text-gray-500">Total bookings</p>
                </div>
              </div>
              <div className="h-[120px]">
                {isLoadingBookings ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500" />
                  </div>
                ) : weeklyChartData.every(day => day.total === 0) ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <BarChart3 className="h-8 w-8 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">No bookings this week</p>
                    <p className="text-xs text-gray-400 mt-1">Bookings will appear here</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyChartData} barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                      <XAxis 
                        dataKey="day" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                      />
                      <YAxis 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#9ca3af', fontSize: 10 }}
                        width={30}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '8px', 
                          border: 'none', 
                          boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                          padding: '8px 12px',
                          fontSize: '12px',
                          backgroundColor: 'white'
                        }}
                        cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                        formatter={(value: any, name: string) => [value, name]}
                        labelFormatter={(label) => `Day: ${label}`}
                      />
                      <Bar dataKey="confirmed" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} name="Confirmed" />
                      <Bar dataKey="pending" stackId="a" fill="#f59e0b" radius={[3, 3, 0, 0]} name="Pending" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="flex items-center justify-center gap-4 mt-2 pt-2 border-t border-gray-50">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-[10px] text-gray-500">Confirmed</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-[10px] text-gray-500">Pending</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* This Month */}
          <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-rose-100 rounded-lg">
                    <BarChart3 className="h-4 w-4 text-rose-600" />
                  </div>
                  <p className="text-gray-700 text-sm font-semibold">This Month</p>
                </div>
                <div className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded-full ${
                  dashboardMetrics.bookingTrend >= 0 
                    ? 'text-emerald-700 bg-emerald-50' 
                    : 'text-red-700 bg-red-50'
                }`}>
                  {dashboardMetrics.bookingTrend >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  <span>{Math.abs(dashboardMetrics.bookingTrend)}%</span>
                </div>
              </div>
              <p className="text-4xl font-bold text-gray-900 mb-1">{dashboardMetrics.thisMonthBookings}</p>
              <p className="text-gray-500 text-sm">Total Bookings</p>
              
              <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-emerald-50 rounded-xl">
                    <p className="text-xl font-bold text-emerald-600">{dashboardMetrics.confirmedBookings}</p>
                    <p className="text-xs text-emerald-600/70 font-medium">Confirmed</p>
                  </div>
                  <div className="text-center p-3 bg-amber-50 rounded-xl">
                    <p className="text-xl font-bold text-amber-600">{dashboardMetrics.pendingBookings}</p>
                    <p className="text-xs text-amber-600/70 font-medium">Pending</p>
                  </div>
                  <div className="text-center p-3 bg-gray-50 rounded-xl">
                    <p className="text-xl font-bold text-gray-500">{dashboardMetrics.cancelledBookings}</p>
                    <p className="text-xs text-gray-500/70 font-medium">Cancelled</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Row 3: Revenue Metrics - This Month */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Total Revenue This Month */}
          <Card 
            className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            onClick={() => onNavigate('revenue')}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-emerald-100 text-[10px] font-medium uppercase tracking-wider">This Month</p>
                  <p className="text-2xl font-bold mt-1">
                    {isLoadingRevenue ? (
                      <span className="text-emerald-100">...</span>
                    ) : revenueMetrics ? (
                      new Intl.NumberFormat('en-CA', {
                        style: 'currency',
                        currency: 'CAD',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(revenueMetrics.totalRevenue || 0)
                    ) : (
                      '$0'
                    )}
                  </p>
                  <p className="text-emerald-100 text-xs mt-1">Total revenue</p>
                </div>
                <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
              <div className="mt-3 pt-3 border-t border-white/20 flex items-center gap-1 text-xs text-emerald-100">
                <span>View details</span>
                <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>

          {/* Your Earnings This Month */}
          <Card 
            className="relative overflow-hidden border-0 bg-gradient-to-br from-blue-500 to-indigo-600 text-white shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 hover:-translate-y-1 cursor-pointer"
            onClick={() => onNavigate('revenue')}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-blue-100 text-[10px] font-medium uppercase tracking-wider">Your Earnings</p>
                  <p className="text-2xl font-bold mt-1">
                    {isLoadingRevenue ? (
                      <span className="text-blue-100">...</span>
                    ) : revenueMetrics ? (
                      new Intl.NumberFormat('en-CA', {
                        style: 'currency',
                        currency: 'CAD',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(revenueMetrics.managerRevenue || 0)
                    ) : (
                      '$0'
                    )}
                  </p>
                  <p className="text-blue-100 text-xs mt-1">After platform fee</p>
                </div>
                <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                  <TrendingUp className="h-4 w-4" />
                </div>
              </div>
              <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
              <div className="mt-3 pt-3 border-t border-white/20 flex items-center gap-1 text-xs text-blue-100">
                <span>View details</span>
                <ArrowRight className="h-3 w-3" />
              </div>
            </CardContent>
          </Card>

          {/* Pending Payments */}
          <Card
            className={`relative overflow-hidden border-0 shadow-lg transition-all duration-300 hover:-translate-y-1 cursor-pointer ${
              revenueMetrics && (revenueMetrics as any).pendingPayments > 0
                ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-amber-500/25 hover:shadow-xl hover:shadow-amber-500/30'
                : 'bg-white border border-gray-100 text-gray-900 hover:shadow-xl'
            }`}
            onClick={() => onNavigate('revenue')}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-[10px] font-medium uppercase tracking-wider ${
                    revenueMetrics && (revenueMetrics as any).pendingPayments > 0 ? 'text-amber-100' : 'text-gray-500'
                  }`}>
                    Pending
                  </p>
                  <p className="text-2xl font-bold mt-1">
                    {isLoadingRevenue ? (
                      <span className={revenueMetrics && (revenueMetrics as any).pendingPayments > 0 ? 'text-amber-100' : 'text-gray-500'}>...</span>
                    ) : revenueMetrics ? (
                      new Intl.NumberFormat('en-CA', {
                        style: 'currency',
                        currency: 'CAD',
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format((revenueMetrics as any).pendingPayments || 0)
                    ) : (
                      '$0'
                    )}
                  </p>
                  <p className={`text-xs mt-1 ${
                    revenueMetrics && revenueMetrics.pendingPayments > 0 ? 'text-amber-100' : 'text-gray-500'
                  }`}>
                    Awaiting payment
                  </p>
                </div>
                <div className={`p-1.5 rounded-lg ${
                  revenueMetrics && (revenueMetrics as any).pendingPayments > 0
                    ? 'bg-white/20 backdrop-blur-sm'
                    : 'bg-amber-100'
                }`}>
                  <Clock className={`h-4 w-4 ${
                    revenueMetrics && (revenueMetrics as any).pendingPayments > 0 ? 'text-white' : 'text-amber-600'
                  }`} />
                </div>
              </div>
              {revenueMetrics && (revenueMetrics as any).pendingPayments > 0 && (
                <>
                  <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
                  <div className="mt-3 pt-3 border-t border-white/20 flex items-center gap-1 text-xs text-amber-100">
                    <span>View details</span>
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          ALERTS / PENDING ACTIONS (if any)
      ═══════════════════════════════════════════════════════════════════════ */}
      {urgentActions.length > 0 && (
        <Card className="border-0 bg-gradient-to-r from-gray-50 to-white shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Bell className="h-4 w-4 text-rose-500" />
              <h3 className="font-semibold text-gray-900 text-sm">Action Required</h3>
            </div>
            <div className="flex flex-wrap gap-3">
              {urgentActions.map((action, idx) => (
                <button
                  key={idx}
                  onClick={() => onNavigate(action.action)}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 hover:scale-105 ${
                    action.type === 'danger' 
                      ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100' 
                      : action.type === 'warning' 
                      ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100' 
                      : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                  }`}
                >
                  <action.icon className="h-4 w-4" />
                  <span className="font-medium">{action.title}</span>
                  <Badge variant="secondary" className={`${
                    action.type === 'danger' ? 'bg-red-200 text-red-800' :
                    action.type === 'warning' ? 'bg-amber-200 text-amber-800' :
                    'bg-blue-200 text-blue-800'
                  }`}>
                    {action.count}
                  </Badge>
                  <ArrowRight className="h-3 w-3 ml-1" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          BOOKING CALENDAR - Main Highlight
      ═══════════════════════════════════════════════════════════════════════ */}
      <BookingCalendarWidget
        bookings={bookings}
        isLoading={isLoadingBookings}
        onNavigateToBookings={() => onNavigate('bookings')}
      />

      {/* ═══════════════════════════════════════════════════════════════════════
          MAIN CONTENT - Recent Bookings & Customer Management Side-by-Side
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Bookings */}
        <Card className="border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-violet-100 rounded-lg">
                  <FileText className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Recent Bookings</CardTitle>
                  <p className="text-xs text-gray-500">Latest requests</p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => onNavigate('bookings')}
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
              >
                View All
                <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            {isLoadingBookings ? (
              <div className="flex items-center justify-center py-8 flex-1">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rose-500" />
              </div>
            ) : recentBookings.length === 0 ? (
              <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
                <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">No bookings yet</p>
                <p className="text-sm text-gray-400">Bookings will appear here</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1">
                {recentBookings.map((booking: any, idx: number) => (
                  <div 
                    key={booking.id || idx}
                    className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 hover:bg-gray-100/70 transition-colors duration-200 cursor-pointer group"
                    onClick={() => onNavigate('bookings')}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        booking.status === 'confirmed' ? 'bg-emerald-100' :
                        booking.status === 'pending' ? 'bg-amber-100' :
                        'bg-gray-100'
                      }`}>
                        <ChefHat className={`h-5 w-5 ${
                          booking.status === 'confirmed' ? 'text-emerald-600' :
                          booking.status === 'pending' ? 'text-amber-600' :
                          'text-gray-500'
                        }`} />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">
                          {booking.chefName || booking.portalUserName || 'Guest Chef'}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <span>{formatDate(booking.bookingDate)}</span>
                          <span className="text-gray-300">•</span>
                          <span>{formatTime(booking.startTime)} - {formatTime(booking.endTime)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge 
                        className={`font-medium ${
                          booking.status === 'confirmed' 
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' 
                            : booking.status === 'pending' 
                            ? 'bg-amber-100 text-amber-700 hover:bg-amber-100' 
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {booking.status === 'confirmed' && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {booking.status === 'pending' && <Clock className="h-3 w-3 mr-1" />}
                        {booking.status === 'cancelled' && <XCircle className="h-3 w-3 mr-1" />}
                        {booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}
                      </Badge>
                      <ArrowRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Management */}
        <CustomerManagementPanel 
          bookings={bookings}
          applications={applications}
          onNavigate={onNavigate}
          isLoading={isLoadingBookings || isLoadingApplications}
        />
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMER MANAGEMENT PANEL - User Management Style Component
// ═══════════════════════════════════════════════════════════════════════════════

interface CustomerManagementPanelProps {
  bookings: any[];
  applications: any[];
  onNavigate: (view: ViewType) => void;
  isLoading: boolean;
}

function CustomerManagementPanel({ bookings, applications, onNavigate, isLoading }: CustomerManagementPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  
  // Count pending applications to set default filter
  const pendingCount = useMemo(() => {
    return applications.filter((app: any) => app.status === 'inReview').length;
  }, [applications]);
  
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'recent' | 'pending'>(
    pendingCount > 0 ? 'pending' : 'all'
  );

  // Extract unique chefs from bookings
  const chefsFromBookings = useMemo(() => {
    const chefMap = new Map<string, {
      id: string;
      name: string;
      email?: string;
      phone?: string;
      totalBookings: number;
      confirmedBookings: number;
      lastBookingDate: Date | null;
      isActive: boolean;
    }>();

    bookings.forEach((booking: any) => {
      const chefId = booking.chefId || booking.userId || booking.portalUserId;
      const chefName = booking.chefName || booking.portalUserName || 'Guest Chef';
      const chefEmail = booking.chefEmail || booking.portalUserEmail;
      const chefPhone = booking.chefPhone || booking.portalUserPhone;
      
      if (!chefId && !chefName) return;
      
      const key = chefId || chefName;
      const existing = chefMap.get(key);
      const bookingDate = new Date(booking.bookingDate);
      const isConfirmed = booking.status === 'confirmed';
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      if (existing) {
        existing.totalBookings += 1;
        if (isConfirmed) existing.confirmedBookings += 1;
        if (!existing.lastBookingDate || bookingDate > existing.lastBookingDate) {
          existing.lastBookingDate = bookingDate;
        }
        existing.isActive = existing.lastBookingDate ? existing.lastBookingDate > thirtyDaysAgo : false;
      } else {
        chefMap.set(key, {
          id: key,
          name: chefName,
          email: chefEmail,
          phone: chefPhone,
          totalBookings: 1,
          confirmedBookings: isConfirmed ? 1 : 0,
          lastBookingDate: bookingDate,
          isActive: bookingDate > thirtyDaysAgo,
        });
      }
    });

    return Array.from(chefMap.values());
  }, [bookings]);

  // Extract unique chefs from applications
  const chefsFromApplications = useMemo(() => {
    const chefMap = new Map<string, {
      id: string;
      name: string;
      email?: string;
      phone?: string;
      applicationStatus: string;
      applicationDate: Date | null;
      locationName?: string;
      isPending: boolean;
    }>();

    applications.forEach((application: any) => {
      const chefId = application.chefId || application.chef?.id;
      const chefName = application.fullName || application.chef?.username || 'Unknown Chef';
      const chefEmail = application.email;
      const chefPhone = application.phone;
      
      if (!chefId && !chefName) return;
      
      const key = chefId?.toString() || chefName;
      const applicationDate = new Date(application.createdAt);
      const isPending = application.status === 'inReview';
      
      // If chef already exists, keep the most recent application
      const existing = chefMap.get(key);
      if (!existing || applicationDate > (existing.applicationDate || new Date(0))) {
        chefMap.set(key, {
          id: key,
          name: chefName,
          email: chefEmail,
          phone: chefPhone,
          applicationStatus: application.status,
          applicationDate: applicationDate,
          locationName: application.location?.name,
          isPending: isPending,
        });
      }
    });

    return Array.from(chefMap.values());
  }, [applications]);

  // Combine chefs from bookings and applications, prioritizing applications
  const chefs = useMemo(() => {
    const combinedMap = new Map<string, {
      id: string;
      name: string;
      email?: string;
      phone?: string;
      totalBookings: number;
      confirmedBookings: number;
      lastBookingDate: Date | null;
      isActive: boolean;
      applicationStatus?: string;
      applicationDate?: Date | null;
      locationName?: string;
      isPending?: boolean;
      hasApplication: boolean;
    }>();

    // First, add chefs from bookings
    chefsFromBookings.forEach(chef => {
      combinedMap.set(chef.id, {
        ...chef,
        hasApplication: false,
      });
    });

    // Then, add/update with chefs from applications
    chefsFromApplications.forEach(chef => {
      const existing = combinedMap.get(chef.id);
      if (existing) {
        // Update existing chef with application info
        existing.applicationStatus = chef.applicationStatus;
        existing.applicationDate = chef.applicationDate;
        existing.locationName = chef.locationName;
        existing.isPending = chef.isPending;
        existing.hasApplication = true;
        // Use application email/phone if booking doesn't have them
        if (!existing.email && chef.email) existing.email = chef.email;
        if (!existing.phone && chef.phone) existing.phone = chef.phone;
      } else {
        // New chef from application only
        combinedMap.set(chef.id, {
          id: chef.id,
          name: chef.name,
          email: chef.email,
          phone: chef.phone,
          totalBookings: 0,
          confirmedBookings: 0,
          lastBookingDate: null,
          isActive: false,
          applicationStatus: chef.applicationStatus,
          applicationDate: chef.applicationDate,
          locationName: chef.locationName,
          isPending: chef.isPending,
          hasApplication: true,
        });
      }
    });

    return Array.from(combinedMap.values()).sort((a, b) => {
      // Sort by: pending applications first, then by most recent activity
      if (a.isPending && !b.isPending) return -1;
      if (!a.isPending && b.isPending) return 1;
      
      const aDate = a.applicationDate || a.lastBookingDate;
      const bDate = b.applicationDate || b.lastBookingDate;
      
      if (!aDate) return 1;
      if (!bDate) return -1;
      return bDate.getTime() - aDate.getTime();
    });
  }, [chefsFromBookings, chefsFromApplications]);

  // Filter chefs based on search and filter
  const filteredChefs = useMemo(() => {
    let result = chefs;
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(chef => 
        chef.name.toLowerCase().includes(query) ||
        chef.email?.toLowerCase().includes(query) ||
        chef.locationName?.toLowerCase().includes(query)
      );
    }
    
    // Apply status filter
    if (activeFilter === 'active') {
      result = result.filter(chef => chef.isActive);
    } else if (activeFilter === 'recent') {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      result = result.filter(chef => {
        const date = chef.applicationDate || chef.lastBookingDate;
        return date && date > sevenDaysAgo;
      });
    } else if (activeFilter === 'pending') {
      result = result.filter(chef => chef.isPending);
    }
    
    return result.slice(0, 5); // Show top 5
  }, [chefs, searchQuery, activeFilter]);

  const filterTabs = [
    { id: 'all' as const, label: 'All', count: chefs.length },
    { id: 'pending' as const, label: 'Pending', count: chefs.filter(c => c.isPending).length },
    { id: 'active' as const, label: 'Active', count: chefs.filter(c => c.isActive).length },
    { id: 'recent' as const, label: 'Recent', count: chefs.filter(c => {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const date = c.applicationDate || c.lastBookingDate;
      return date && date > sevenDaysAgo;
    }).length },
  ];

  // Generate avatar initials
  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate avatar color based on name
  const getAvatarColor = (name: string) => {
    const colors = [
      'bg-rose-500',
      'bg-violet-500',
      'bg-blue-500',
      'bg-emerald-500',
      'bg-amber-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500',
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300 flex flex-col">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Users className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-base">Customer Management</CardTitle>
              <p className="text-xs text-gray-500">Chefs</p>
            </div>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => onNavigate('applications')}
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
          >
            View All
            <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 flex-1 flex flex-col">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            type="text"
            placeholder="Search chefs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 bg-gray-50/50 border-gray-200 focus:bg-white focus:border-gray-300 focus:ring-0 rounded-lg text-sm"
          />
        </div>

        {/* Filter Tabs - Minimal Design */}
        <div className="flex items-center gap-1">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                activeFilter === tab.id
                  ? 'text-rose-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.id === 'active' && (
                <span className={`w-1.5 h-1.5 rounded-full ${activeFilter === tab.id ? 'bg-rose-500' : 'bg-emerald-500'}`} />
              )}
              {tab.id === 'pending' && (
                <span className={`w-1.5 h-1.5 rounded-full ${activeFilter === tab.id ? 'bg-rose-500' : 'bg-amber-500'}`} />
              )}
              <span>{tab.label}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                activeFilter === tab.id 
                  ? 'bg-rose-50 text-rose-600' 
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {tab.count}
              </span>
              {activeFilter === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-rose-500 rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Chef List */}
        <div className="space-y-2 flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 flex-1">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-rose-500" />
            </div>
          ) : filteredChefs.length === 0 ? (
            <div className="text-center py-6 flex-1 flex flex-col items-center justify-center">
              <Users className="h-10 w-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No chefs found</p>
              <p className="text-gray-400 text-xs">Chef applications and bookings will appear here</p>
            </div>
          ) : (
            filteredChefs.map((chef, idx) => (
              <div
                key={chef.id || idx}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50/80 transition-colors duration-200 cursor-pointer group border border-transparent hover:border-gray-100"
                onClick={() => onNavigate('applications')}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full ${getAvatarColor(chef.name)} flex items-center justify-center text-white font-semibold text-sm shadow-sm flex-shrink-0`}>
                  {getInitials(chef.name)}
                </div>
                
                {/* Chef Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 text-sm leading-tight break-words">{chef.name}</p>
                    {chef.isPending && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-md text-[10px] font-medium border border-amber-100">
                        <span className="w-1 h-1 rounded-full bg-amber-500" />
                        Pending
                      </span>
                    )}
                    {chef.isActive && !chef.isPending && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-md text-[10px] font-medium border border-emerald-100">
                        <span className="w-1 h-1 rounded-full bg-emerald-500" />
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-tight break-words">
                    {chef.email || chef.locationName || `${chef.totalBookings} booking${chef.totalBookings !== 1 ? 's' : ''}`}
                  </p>
                  {chef.locationName && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{chef.locationName}</p>
                  )}
                </div>

                {/* Status Badge */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="text-right">
                    {chef.hasApplication && chef.isPending ? (
                      <>
                        <p className="text-sm font-semibold text-amber-600">Review</p>
                        <p className="text-[10px] text-gray-400">needed</p>
                      </>
                    ) : chef.totalBookings > 0 ? (
                      <>
                        <p className="text-sm font-semibold text-gray-900">{chef.confirmedBookings}</p>
                        <p className="text-[10px] text-gray-400">bookings</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-gray-500">New</p>
                        <p className="text-[10px] text-gray-400">applicant</p>
                      </>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-60 transition-opacity" />
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

