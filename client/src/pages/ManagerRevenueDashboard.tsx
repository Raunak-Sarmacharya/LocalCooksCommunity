/**
 * Manager Revenue Dashboard
 * 
 * Comprehensive revenue monitoring dashboard for managers.
 * Displays revenue metrics, charts, transaction history, and invoices.
 * Matches the aesthetic of KitchenDashboardOverview component.
 */

import { useState, useMemo } from "react";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  FileText,
  Download,
  Filter,
  MapPin,
  BarChart3,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  ArrowRight,
  Search,
  Eye,
  Loader2,
  CreditCard,
  Receipt,
  CheckCircle2,
  Percent,
  Info,
  AlertCircle,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface Location {
  id: number;
  name: string;
}

interface ManagerRevenueDashboardProps {
  selectedLocation: Location | null;
  locations: Location[];
  onNavigate?: (view: string) => void;
}

type DateRange = 'today' | 'week' | 'month' | 'custom';

interface RefundEligibility {
  eligible: boolean;
  maxRefundable: number;
  totalAmount: number;
  refundedAmount: number;
  payoutStatus: string | null;
  blockReason?: string;
  paymentIntentStatus?: string;
  bookingId?: number;
  bookingType?: string;
  currency?: string;
}

// Helper function to get auth headers
async function getAuthHeaders(): Promise<HeadersInit> {
  const currentFirebaseUser = auth.currentUser;
  if (!currentFirebaseUser) {
    throw new Error("Firebase user not available");
  }
  const token = await currentFirebaseUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
  };
}

// Format currency helper
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// Format date helper
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: 'numeric'
  });
}

// Format date for chart labels
function formatChartDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getTransactionTotalCents(transaction: any): number {
  if (transaction?._raw?.totalPrice !== undefined && transaction?._raw?.totalPrice !== null) {
    return Number(transaction._raw.totalPrice) || 0;
  }
  const totalDollars = Number(transaction?.totalPrice) || 0;
  return Math.round(totalDollars * 100);
}

function getTransactionTaxCents(transaction: any): number {
  const taxRatePercent = Number(transaction?.taxRatePercent);
  if (!taxRatePercent || Number.isNaN(taxRatePercent) || taxRatePercent <= 0) {
    return 0;
  }
  const rate = taxRatePercent / 100;
  const totalCents = getTransactionTotalCents(transaction);
  const estimatedSubtotalCents = totalCents / (1 + rate);
  const taxCents = Math.round(totalCents - estimatedSubtotalCents);
  return Math.max(0, taxCents);
}

function getStripeProcessingFeeCents(transaction: any): number {
  const totalCents = getTransactionTotalCents(transaction);
  if (totalCents <= 0) {
    return 0;
  }
  return Math.max(0, Math.round(totalCents * 0.029 + 30));
}

function getTransactionEarningsCents(transaction: any): number {
  const totalCents = getTransactionTotalCents(transaction);
  const taxCents = getTransactionTaxCents(transaction);
  const processingFeeCents = getStripeProcessingFeeCents(transaction);
  return Math.max(0, totalCents - taxCents - processingFeeCents);
}

export default function ManagerRevenueDashboard({
  selectedLocation,
  locations,
  onNavigate,
}: ManagerRevenueDashboardProps) {
  const { user: firebaseUser } = useFirebaseAuth();
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState<DateRange>('month');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [selectedLocationFilter, setSelectedLocationFilter] = useState<number | 'all'>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<any | null>(null);
  const [refundAmount, setRefundAmount] = useState<string>('');
  const [refundReason, setRefundReason] = useState<string>('');
  const [refundError, setRefundError] = useState<string | null>(null);
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // Calculate date range based on selection
  const dateRangeParams = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let startDate: Date;
    let endDate: Date = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (dateRange) {
      case 'today':
        startDate = new Date(today);
        break;
      case 'week':
        startDate = new Date(today);
        startDate.setDate(today.getDate() - 7);
        break;
      case 'month':
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'custom':
        if (customStartDate && customEndDate) {
          startDate = new Date(customStartDate);
          endDate = new Date(customEndDate);
          endDate.setHours(23, 59, 59, 999);
        } else {
          // Default to this month if custom dates not set
          startDate = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        break;
      default:
        startDate = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }, [dateRange, customStartDate, customEndDate]);

  // Fetch revenue overview
  const { data: revenueMetrics, isLoading: isLoadingMetrics } = useQuery({
    queryKey: ['/api/manager/revenue/overview', dateRangeParams.startDate, dateRangeParams.endDate, selectedLocationFilter],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
      });
      if (selectedLocationFilter !== 'all') {
        params.append('locationId', selectedLocationFilter.toString());
      }
      
      const response = await fetch(`/api/manager/revenue/overview?${params}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch revenue metrics');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch revenue by location
  const { data: revenueByLocation } = useQuery({
    queryKey: ['/api/manager/revenue/by-location', dateRangeParams.startDate, dateRangeParams.endDate],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
      });
      
      const response = await fetch(`/api/manager/revenue/by-location?${params}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch revenue by location');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch chart data
  const { data: chartData } = useQuery({
    queryKey: ['/api/manager/revenue/charts', dateRangeParams.startDate, dateRangeParams.endDate, selectedLocationFilter],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
        period: 'daily',
      });
      if (selectedLocationFilter !== 'all') {
        params.append('locationId', selectedLocationFilter.toString());
      }
      
      const response = await fetch(`/api/manager/revenue/charts?${params}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch chart data');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch transaction history
  const { data: transactionsData, isLoading: isLoadingTransactions } = useQuery({
    queryKey: ['/api/manager/revenue/transactions', dateRangeParams.startDate, dateRangeParams.endDate, selectedLocationFilter, paymentStatusFilter],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
        limit: '50',
        offset: '0',
      });
      if (selectedLocationFilter !== 'all') {
        params.append('locationId', selectedLocationFilter.toString());
      }
      if (paymentStatusFilter !== 'all') {
        params.append('paymentStatus', paymentStatusFilter);
      }
      
      const response = await fetch(`/api/manager/revenue/transactions?${params}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch transactions');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch invoices
  const { data: invoicesData } = useQuery({
    queryKey: ['/api/manager/revenue/invoices', dateRangeParams.startDate, dateRangeParams.endDate, selectedLocationFilter],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startDate: dateRangeParams.startDate,
        endDate: dateRangeParams.endDate,
        limit: '20',
        offset: '0',
      });
      if (selectedLocationFilter !== 'all') {
        params.append('locationId', selectedLocationFilter.toString());
      }
      
      const response = await fetch(`/api/manager/revenue/invoices?${params}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch invoices');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch Stripe Connect status
  const { data: stripeConnectStatus } = useQuery({
    queryKey: ['/api/manager/stripe-connect/status'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/stripe-connect/status', {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch Stripe Connect status');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  // Fetch payout history
  const { data: payoutsData, isLoading: isLoadingPayouts } = useQuery({
    queryKey: ['/api/manager/revenue/payouts'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/revenue/payouts', {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch payouts');
      }
      return response.json();
    },
    enabled: !!firebaseUser,
  });

  const refundEligibilityTargets = useMemo(() => {
    if (!transactionsData?.transactions) return [];
    return transactionsData.transactions
      .filter((t: any) => t.paymentStatus === 'paid' && t.paymentIntentId)
      .map((t: any) => ({
        bookingId: t.id,
        bookingType: t.bookingType || 'kitchen',
      }));
  }, [transactionsData]);

  const refundEligibilityQueries = useQueries({
    queries: refundEligibilityTargets.map((target: { bookingType: any; bookingId: any; }) => ({
      queryKey: ['refund-eligibility', target.bookingType, target.bookingId],
      queryFn: async () => {
        const headers = await getAuthHeaders();
        const response = await fetch('/api/manager/payments/refund-eligibility', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({
            bookingId: target.bookingId,
            bookingType: target.bookingType,
          }),
        });
        if (!response.ok) {
          throw new Error('Failed to check refund eligibility');
        }
        return response.json();
      },
      enabled: !!firebaseUser,
      staleTime: 1000 * 60 * 2,
      retry: false,
    })),
  });

  const refundEligibilityStateMap = useMemo(() => {
    const map = new Map<string, { data?: RefundEligibility; isLoading: boolean; isError: boolean }>();
    refundEligibilityQueries.forEach((query, index) => {
      const target = refundEligibilityTargets[index];
      if (!target) return;
      map.set(`${target.bookingType}:${target.bookingId}`, {
        data: query.data as RefundEligibility | undefined,
        isLoading: query.isLoading,
        isError: query.isError,
      });
    });
    return map;
  }, [refundEligibilityQueries, refundEligibilityTargets]);

  // Filter transactions by search query
  const filteredTransactions = useMemo(() => {
    if (!transactionsData?.transactions) return [];
    if (!searchQuery.trim()) return transactionsData.transactions;
    
    const query = searchQuery.toLowerCase();
    return transactionsData.transactions.filter((t: any) =>
      t.chefName?.toLowerCase().includes(query) ||
      t.kitchenName?.toLowerCase().includes(query) ||
      t.locationName?.toLowerCase().includes(query) ||
      t.paymentIntentId?.toLowerCase().includes(query)
    );
  }, [transactionsData, searchQuery]);

  // Calculate totals for transaction history table
  const transactionTotals = useMemo(() => {
    if (!filteredTransactions || filteredTransactions.length === 0) {
      return { totalPriceCents: 0, managerEarningsCents: 0 };
    }
    
    return filteredTransactions.reduce(
      (acc: { totalPriceCents: number; managerEarningsCents: number }, t: any) => {
        const totalCents = getTransactionTotalCents(t);
        const earningsCents = getTransactionEarningsCents(t);
        return {
          totalPriceCents: acc.totalPriceCents + totalCents,
          managerEarningsCents: acc.managerEarningsCents + earningsCents,
        };
      },
      { totalPriceCents: 0, managerEarningsCents: 0 }
    );
  }, [filteredTransactions]);

  // Prepare chart data for revenue trend
  const revenueTrendData = useMemo(() => {
    if (!chartData?.data) return [];
    return chartData.data.map((item: any) => ({
      date: formatChartDate(item.date),
      totalRevenue: item.totalRevenue,
      managerRevenue: item.managerRevenue,
      platformFee: item.platformFee,
    }));
  }, [chartData]);

  // Prepare data for location breakdown chart
  const locationChartData = useMemo(() => {
    if (!revenueByLocation) return [];
    return revenueByLocation.map((loc: any) => ({
      name: loc.locationName.length > 15 ? loc.locationName.substring(0, 15) + '...' : loc.locationName,
      fullName: loc.locationName,
      managerRevenue: loc.managerRevenue,
      platformFee: loc.platformFee,
    }));
  }, [revenueByLocation]);

  // Prepare data for payment status pie chart
  // Show amounts (in dollars) instead of counts for better financial visibility
  const paymentStatusData = useMemo(() => {
    if (!transactionsData?.transactions) return [];
    const statusAmounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    
    transactionsData.transactions.forEach((t: any) => {
      // Use paymentStatus from transaction, default to 'pending' if not set
      const status = t.paymentStatus || 'pending';
      // For paid/processing transactions, show managerRevenue (what manager actually receives)
      // For other statuses, show totalPrice (what was charged)
      const amount = (status === 'paid' || status === 'processing') 
        ? (t.managerRevenue || 0) // Manager's actual earnings after fees
        : (t.totalPrice || 0); // Total amount charged
      
      statusAmounts[status] = (statusAmounts[status] || 0) + amount;
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    const statusLabels: Record<string, string> = {
      paid: 'Paid (In Your Account)',
      processing: 'Processing',
      failed: 'Failed',
      refunded: 'Refunded',
      partially_refunded: 'Partially Refunded',
      canceled: 'Canceled',
    };
    
    // Return data with amounts, filtering out zero amounts
    return Object.entries(statusAmounts)
      .filter(([_, amount]) => amount > 0)
      .map(([status, amount]) => ({
        name: statusLabels[status] || status.charAt(0).toUpperCase() + status.slice(1),
        value: Math.round(amount * 100) / 100, // Round to 2 decimal places
        status,
        count: statusCounts[status] || 0,
      }))
      .sort((a, b) => b.value - a.value); // Sort by amount descending
  }, [transactionsData]);

  const COLORS = {
    paid: '#10b981',
    pending: '#f59e0b',
    processing: '#3b82f6',
    failed: '#ef4444',
    refunded: '#6b7280',
    partially_refunded: '#9ca3af',
    canceled: '#9ca3af',
  };

  const getPaymentStatusColor = (status: string) => {
    return COLORS[status as keyof typeof COLORS] || '#6b7280';
  };

  const getPaymentStatusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string; label: string; tooltip?: string }> = {
      paid: {
        bg: 'bg-emerald-100',
        text: 'text-emerald-700',
        label: 'Paid',
        tooltip: 'Payment has been processed and is in your Stripe Connect account or ready for payout'
      },
      pending: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        label: 'Pending',
        tooltip: 'Payment is pending and will be processed after the cancellation period expires'
      },
      processing: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        label: 'Processing',
        tooltip: 'Payment is being processed. This usually happens automatically after the cancellation period expires.'
      },
      failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
      refunded: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Refunded' },
      partially_refunded: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Partially Refunded' },
      canceled: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Canceled' },
    };
    const color = colors[status] || colors.pending || { bg: 'bg-gray-100', text: 'text-gray-700', label: status || 'Unknown' };
    const badge = (
      <Badge className={`${color.bg} ${color.text} border-0 font-medium`}>
        {color.label}
      </Badge>
    );
    
    if (color.tooltip) {
      return (
        <div className="group relative inline-block">
          {badge}
          <div className="absolute left-0 bottom-full mb-2 w-72 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
            {color.tooltip}
          </div>
        </div>
      );
    }
    
    return badge;
  };

  // Download invoice handler
  const handleDownloadInvoice = async (bookingId: number) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/revenue/invoices/${bookingId}`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to download invoice');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${bookingId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading invoice:', error);
    }
  };

  // Download payout statement handler
  const handleDownloadPayoutStatement = async (payoutId: string) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/revenue/payouts/${payoutId}/statement`, {
        headers,
        credentials: 'include',
      });
      
      if (!response.ok) {
        throw new Error('Failed to download payout statement');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payout-statement-${payoutId.substring(3)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading payout statement:', error);
    }
  };

  const resetRefundState = () => {
    setRefundDialogOpen(false);
    setRefundTarget(null);
    setRefundAmount('');
    setRefundReason('');
    setRefundError(null);
    setIsRefundSubmitting(false);
  };

  const handleOpenRefundDialog = (transaction: any) => {
    setRefundTarget(transaction);
    setRefundError(null);
    const bookingType = transaction.bookingType || 'kitchen';
    const eligibilityState = refundEligibilityStateMap.get(`${bookingType}:${transaction.id}`);
    const eligibility = eligibilityState?.data;
    if (eligibility?.maxRefundable) {
      setRefundAmount((eligibility.maxRefundable / 100).toFixed(2));
    } else {
      setRefundAmount('');
    }
    setRefundReason('');
    setRefundDialogOpen(true);
  };

  const handleSubmitRefund = async () => {
    if (!refundTarget) return;
    setRefundError(null);

    const bookingType = refundTarget.bookingType || 'kitchen';
    const eligibilityState = refundEligibilityStateMap.get(`${bookingType}:${refundTarget.id}`);
    const eligibility = eligibilityState?.data;

    const amountNumber = Number.parseFloat(refundAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      setRefundError('Enter a valid refund amount.');
      return;
    }

    const amountCents = Math.round(amountNumber * 100);
    if (eligibility && amountCents > eligibility.maxRefundable) {
      setRefundError('Refund amount exceeds the maximum refundable amount.');
      return;
    }

    setIsRefundSubmitting(true);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/payments/refund', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          bookingId: refundTarget.id,
          bookingType,
          amountCents,
          reason: refundReason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to issue refund');
      }

      resetRefundState();

      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/overview'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/charts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/by-location'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/revenue/invoices'] });
      queryClient.invalidateQueries({ queryKey: ['refund-eligibility', bookingType, refundTarget.id] });
    } catch (error: any) {
      console.error('Error issuing refund:', error);
      setRefundError(error.message || 'Failed to issue refund');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  const getPayoutStatusBadge = (status: string) => {
    const colors: Record<string, { bg: string; text: string }> = {
      paid: { bg: 'bg-emerald-100', text: 'text-emerald-700' },
      pending: { bg: 'bg-amber-100', text: 'text-amber-700' },
      in_transit: { bg: 'bg-blue-100', text: 'text-blue-700' },
      canceled: { bg: 'bg-gray-100', text: 'text-gray-700' },
      failed: { bg: 'bg-red-100', text: 'text-red-700' },
    };
    const color = colors[status] || colors.pending;
    return (
      <Badge className={`${color.bg} ${color.text} border-0 font-medium`}>
        {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
      </Badge>
    );
  };

  const selectedBookingType = refundTarget?.bookingType || 'kitchen';
  const selectedEligibilityState = refundTarget
    ? refundEligibilityStateMap.get(`${selectedBookingType}:${refundTarget.id}`)
    : undefined;
  const selectedEligibility = selectedEligibilityState?.data;
  const maxRefundableCents = selectedEligibility?.maxRefundable;
  const refundAmountNumber = Number.parseFloat(refundAmount);
  const refundAmountCents = Number.isFinite(refundAmountNumber) ? Math.round(refundAmountNumber * 100) : 0;
  const refundAmountExceedsMax = !!selectedEligibility && refundAmountCents > (selectedEligibility.maxRefundable || 0);
  const refundActionDisabled =
    !refundTarget ||
    !selectedEligibility?.eligible ||
    refundAmountCents <= 0 ||
    refundAmountExceedsMax ||
    isRefundSubmitting;

  return (
    <div className="space-y-6">
      {/* ═══════════════════════════════════════════════════════════════════════
          HEADER WITH FILTERS
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
            Revenue Dashboard
          </h1>
          <p className="text-gray-500 mt-1">
            Track your earnings, payments, and financial performance
          </p>
        </div>
        
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date Range Filter */}
          <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>

          {/* Custom Date Range */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="w-[140px]"
              />
              <span className="text-gray-500">to</span>
              <Input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="w-[140px]"
              />
            </div>
          )}

          {/* Location Filter */}
          {locations.length > 1 && (
            <Select 
              value={selectedLocationFilter === 'all' ? 'all' : selectedLocationFilter.toString()} 
              onValueChange={(value) => setSelectedLocationFilter(value === 'all' ? 'all' : parseInt(value))}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          PRIMARY REVENUE METRICS - Matching Overview Style
      ═══════════════════════════════════════════════════════════════════════ */}
      {isLoadingMetrics ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-rose-500" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Payment System Info Banner */}
          <Card className="border border-blue-200 bg-blue-50/50">
            <CardContent className="p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-800">
                  <p className="font-medium mb-1">Understanding Your Revenue</p>
                  <p className="text-blue-700">
                    <strong>Completed Payments (In Your Account):</strong> Money that has been successfully processed and is available in your Stripe Connect account or ready for payout.
                    <br />
                    <strong>Processing Payments:</strong> Payments that are currently being processed and will be available shortly.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          {/* Row 1: Revenue Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Total Revenue */}
            <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all duration-300 hover:-translate-y-1">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-emerald-100 text-[10px] font-medium uppercase tracking-wider">Total Revenue</p>
                    <p className="text-2xl font-bold mt-1">
                      {revenueMetrics ? formatCurrency(revenueMetrics.totalRevenue) : '$0.00'}
                    </p>
                    <p className="text-emerald-100 text-xs mt-1">All bookings</p>
                  </div>
                  <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                    <DollarSign className="h-4 w-4" />
                  </div>
                </div>
                <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
              </CardContent>
            </Card>

            {/* Average Booking Value */}
            <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-xl hover:shadow-purple-500/30 transition-all duration-300 hover:-translate-y-1">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-purple-100 text-[10px] font-medium uppercase tracking-wider">Avg Booking</p>
                    <p className="text-2xl font-bold mt-1">
                      {revenueMetrics ? formatCurrency(revenueMetrics.averageBookingValue) : '$0.00'}
                    </p>
                    <p className="text-purple-100 text-xs mt-1">
                      {revenueMetrics?.bookingCount || 0} total bookings
                    </p>
                  </div>
                  <div className="p-1.5 bg-white/20 rounded-lg backdrop-blur-sm">
                    <BarChart3 className="h-4 w-4" />
                  </div>
                </div>
                <div className="absolute -bottom-3 -right-3 w-20 h-20 bg-white/10 rounded-full blur-xl" />
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Additional Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Platform Fee
            <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-gray-500 text-xs font-medium">Platform Fee</p>
                    <p className="text-xl font-bold text-gray-900 mt-1">
                      {revenueMetrics ? formatCurrency(revenueMetrics.platformFee) : '$0.00'}
                    </p>
                  </div>
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <Percent className="h-4 w-4 text-gray-600" />
                  </div>
                </div>
              </CardContent>
            </Card> */}

            {/* Completed Payments */}
            <Card className="border border-emerald-200 shadow-sm bg-emerald-50/30 hover:shadow-md transition-shadow duration-300">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-gray-700 text-xs font-medium">Completed (In Your Account)</p>
                      <div className="group relative">
                        <Info className="h-3 w-3 text-gray-400 cursor-help" />
                        <div className="absolute left-0 bottom-full mb-2 w-72 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          Money that has been successfully processed and is available in your Stripe Connect account or ready for payout to your bank (after platform fees).
                        </div>
                      </div>
                    </div>
                    <p className="text-xl font-bold text-emerald-600 mt-1">
                      {revenueMetrics ? (() => {
                        // Calculate manager revenue from completed payments: total - platform fees
                        const completedTotal = revenueMetrics.completedPayments || 0;
                        const totalRevenue = revenueMetrics.totalRevenue || 0;
                        const platformFee = revenueMetrics.platformFee || 0;
                        // Calculate platform fee portion from completed payments proportionally
                        const completedPlatformFee = totalRevenue > 0 
                          ? (platformFee * (completedTotal / totalRevenue))
                          : 0;
                        const managerRevenueFromCompleted = completedTotal - completedPlatformFee;
                        return formatCurrency(managerRevenueFromCompleted);
                      })() : '$0.00'}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {revenueMetrics?.paidBookingCount || 0} {revenueMetrics?.paidBookingCount === 1 ? 'booking' : 'bookings'} processed
                    </p>
                  </div>
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Refunded Amount */}
            {revenueMetrics && revenueMetrics.refundedAmount > 0 && (
              <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-gray-500 text-xs font-medium">Refunded</p>
                      <p className="text-xl font-bold text-gray-600 mt-1">
                        {formatCurrency(revenueMetrics.refundedAmount)}
                      </p>
                    </div>
                    <div className="p-2 bg-gray-100 rounded-lg">
                      <ArrowRight className="h-4 w-4 text-gray-600 rotate-180" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          CHARTS SECTION
      ═══════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Trend Chart */}
        <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-100 rounded-lg">
                  <LineChartIcon className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Revenue Trend</CardTitle>
                  <p className="text-xs text-gray-500">Daily revenue over time</p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {revenueTrendData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <LineChartIcon className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No revenue data</p>
                  <p className="text-xs text-gray-400 mt-1">Revenue will appear here</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorManagerRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorTotalRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      width={50}
                      tickFormatter={(value) => `$${value.toFixed(0)}`}
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        borderRadius: '8px', 
                        border: 'none', 
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        padding: '8px 12px',
                        fontSize: '12px',
                        backgroundColor: 'white'
                      }}
                      formatter={(value: any) => formatCurrency(value)}
                    />
                    <Legend 
                      wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }}
                      iconType="circle"
                    />
                    <Area
                      type="monotone"
                      dataKey="totalRevenue"
                      stroke="#10b981"
                      fillOpacity={1}
                      fill="url(#colorTotalRevenue)"
                      name="Total Revenue"
                    />
                    <Area
                      type="monotone"
                      dataKey="managerRevenue"
                      stroke="#3b82f6"
                      fillOpacity={1}
                      fill="url(#colorManagerRevenue)"
                      name="Your Earnings"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Revenue by Location OR Payment Status */}
        <Card className="border border-gray-200 shadow-sm bg-white hover:shadow-md transition-shadow duration-300">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-violet-100 rounded-lg">
                  <BarChart3 className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <CardTitle className="text-base">
                    {locations.length > 1 ? 'Revenue by Location' : 'Payment Status'}
                  </CardTitle>
                  <p className="text-xs text-gray-500">
                    {locations.length > 1 ? 'Breakdown by location' : 'Payment distribution'}
                  </p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[280px]">
              {locations.length > 1 && locationChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={locationChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      angle={-45}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 10 }}
                      width={50}
                      tickFormatter={(value) => `$${value.toFixed(0)}`}
                    />
                    <RechartsTooltip 
                      contentStyle={{ 
                        borderRadius: '8px', 
                        border: 'none', 
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        padding: '8px 12px',
                        fontSize: '12px',
                        backgroundColor: 'white'
                      }}
                      formatter={(value: any) => formatCurrency(value)}
                      labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
                    />
                    <Bar dataKey="managerRevenue" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Your Earnings" />
                    <Bar dataKey="platformFee" fill="#6b7280" radius={[4, 4, 0, 0]} name="Platform Fee" />
                  </BarChart>
                </ResponsiveContainer>
              ) : paymentStatusData.length > 0 ? (
                <div className="flex flex-col items-center justify-center h-full">
                  {paymentStatusData.length === 1 && paymentStatusData[0].value > 0 ? (
                    // Special case: Single category (100%) - show donut chart with center text
                    <div className="relative w-full h-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RechartsPieChart>
                          <Pie
                            data={paymentStatusData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={90}
                            fill="#8884d8"
                            dataKey="value"
                            startAngle={90}
                            endAngle={-270}
                          >
                            {paymentStatusData.map((entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={getPaymentStatusColor(entry.status)} />
                            ))}
                          </Pie>
                          <RechartsTooltip 
                            contentStyle={{ 
                              borderRadius: '8px', 
                              border: 'none', 
                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              padding: '8px 12px',
                              fontSize: '12px',
                              backgroundColor: 'white'
                            }}
                            formatter={(value: any) => formatCurrency(value)}
                          />
                        </RechartsPieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="text-2xl font-bold" style={{ color: getPaymentStatusColor(paymentStatusData[0].status) }}>
                          {formatCurrency(paymentStatusData[0].value)}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {paymentStatusData[0].name}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {paymentStatusData[0].count} {paymentStatusData[0].count === 1 ? 'booking' : 'bookings'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    // Multiple categories - show standard pie chart
                    <ResponsiveContainer width="100%" height="100%">
                      <RechartsPieChart>
                        <Pie
                          data={paymentStatusData}
                          cx="50%"
                          cy="50%"
                          labelLine={true}
                          label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                          outerRadius={90}
                          innerRadius={30}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {paymentStatusData.map((entry: any, index: number) => (
                            <Cell key={`cell-${index}`} fill={getPaymentStatusColor(entry.status)} />
                          ))}
                        </Pie>
                        <RechartsTooltip 
                          contentStyle={{ 
                            borderRadius: '8px', 
                            border: 'none', 
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            padding: '8px 12px',
                            fontSize: '12px',
                            backgroundColor: 'white'
                          }}
                          formatter={(value: any, name: any, props: any) => {
                            const total = paymentStatusData.reduce((sum: number, item: any) => sum + item.value, 0);
                            const percent = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
                            const count = props.payload?.count || 0;
                            return [
                              `${formatCurrency(value)} (${percent}%) - ${count} ${count === 1 ? 'booking' : 'bookings'}`,
                              name
                            ];
                          }}
                        />
                        <Legend 
                          wrapperStyle={{ fontSize: '12px', paddingTop: '16px' }}
                          iconType="circle"
                          formatter={(value, entry: any) => {
                            const total = paymentStatusData.reduce((sum: number, item: any) => sum + item.value, 0);
                            const percent = total > 0 ? ((entry.payload.value / total) * 100).toFixed(1) : '0';
                            return `${value}: ${formatCurrency(entry.payload.value)} (${percent}%)`;
                          }}
                        />
                      </RechartsPieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <PieChartIcon className="h-8 w-8 text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500">No data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          TRANSACTION HISTORY TABLE
      ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border border-gray-200 shadow-sm bg-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-rose-100 rounded-lg">
                <Receipt className="h-4 w-4 text-rose-600" />
              </div>
              <div>
                <CardTitle className="text-base">Transaction History</CardTitle>
                <p className="text-xs text-gray-500">All booking transactions</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Payment Status Filter */}
              <Select value={paymentStatusFilter} onValueChange={setPaymentStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="paid">Paid (In Account)</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
              
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px]"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingTransactions ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No transactions found</p>
              <p className="text-sm text-gray-400 mt-1">Transactions will appear here</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Chef</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Your Earnings</th>
                    <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTransactions.map((transaction: any) => {
                    const bookingType = transaction.bookingType || 'kitchen';
                    const eligibilityState = refundEligibilityStateMap.get(`${bookingType}:${transaction.id}`);
                    const eligibility = eligibilityState?.data;
                    const refundDisabledBase = transaction.paymentStatus !== 'paid' || !transaction.paymentIntentId;
                    const refundBlocked = !!eligibility && !eligibility.eligible;
                    const refundDisabled = refundDisabledBase || refundBlocked;
                    const refundTooltip = refundDisabledBase
                      ? (!transaction.paymentIntentId
                        ? 'No payment information available for this booking.'
                        : transaction.paymentStatus === 'refunded'
                          ? 'This booking has already been refunded.'
                          : transaction.paymentStatus === 'partially_refunded'
                            ? 'This booking has already been partially refunded.'
                            : transaction.paymentStatus === 'failed'
                              ? 'Payment failed and cannot be refunded.'
                              : transaction.paymentStatus === 'processing'
                                ? 'Payment is still processing.'
                                : 'Refunds are only available after payment succeeds.')
                      : refundBlocked
                        ? (eligibility?.blockReason || 'Refund not available')
                        : eligibilityState?.isLoading
                          ? 'Checking refund eligibility...'
                          : eligibilityState?.isError
                            ? 'Unable to verify refund eligibility'
                            : 'Issue refund';

                    return (
                      <tr key={transaction.id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {formatDate(transaction.bookingDate)}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900">
                        {transaction.chefName || 'Guest'}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {transaction.locationName}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-medium text-gray-900">
                        {formatCurrency(getTransactionTotalCents(transaction) / 100)}
                      </td>
                      <td className="py-3 px-4 text-sm text-right font-semibold text-blue-600">
                        {formatCurrency(getTransactionEarningsCents(transaction) / 100)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {getPaymentStatusBadge(transaction.paymentStatus)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <TooltipProvider delayDuration={150}>
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDownloadInvoice(transaction.id)}
                              className="h-8 w-8 p-0"
                            >
                              <Download className="h-4 w-4 text-gray-600" />
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenRefundDialog(transaction)}
                                    className="h-8 w-8 p-0"
                                    disabled={refundDisabled}
                                  >
                                    <RotateCcw className="h-4 w-4 text-gray-600" />
                                  </Button>
                                </span>
                              </TooltipTrigger>
                              {refundTooltip && (
                                <TooltipContent>
                                  <p className="text-xs">{refundTooltip}</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td colSpan={3} className="py-3 px-4 text-sm text-gray-900">
                      Total ({filteredTransactions.length} {filteredTransactions.length === 1 ? 'transaction' : 'transactions'})
                    </td>
                    <td className="py-3 px-4 text-sm text-right font-semibold text-gray-900">
                      {formatCurrency(transactionTotals.totalPriceCents / 100)}
                    </td>
                    <td className="py-3 px-4 text-sm text-right font-semibold text-blue-600">
                      {formatCurrency(transactionTotals.managerEarningsCents / 100)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════
          RECENT INVOICES
      ═══════════════════════════════════════════════════════════════════════ */}
      {invoicesData && invoicesData.invoices && invoicesData.invoices.length > 0 && (
        <Card className="border border-gray-200 shadow-sm bg-white">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-violet-100 rounded-lg">
                  <FileText className="h-4 w-4 text-violet-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Recent Invoices</CardTitle>
                  <p className="text-xs text-gray-500">Latest booking invoices</p>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoicesData.invoices.slice(0, 5).map((invoice: any) => (
                <div
                  key={invoice.bookingId}
                  className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 hover:bg-gray-100/70 transition-colors duration-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-violet-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        Invoice #{invoice.bookingId}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{formatDate(invoice.bookingDate)}</span>
                        <span className="text-gray-300">•</span>
                        <span>{invoice.kitchenName}</span>
                        <span className="text-gray-300">•</span>
                        <span>{formatCurrency(invoice.totalPrice)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPaymentStatusBadge(invoice.paymentStatus)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadInvoice(invoice.bookingId)}
                      className="h-8"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          PAYOUT HISTORY
      ═══════════════════════════════════════════════════════════════════════ */}
      <Card className="border border-gray-200 shadow-sm bg-white">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-emerald-100 rounded-lg">
                <CreditCard className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-base">Payout History</CardTitle>
                <p className="text-xs text-gray-500">Your Stripe Connect payouts</p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Stripe Connect Reminder */}
          {stripeConnectStatus && (!stripeConnectStatus.hasAccount || stripeConnectStatus.status !== 'complete') && (
            <Alert className="mb-4 border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-900 font-semibold">
                {!stripeConnectStatus.hasAccount 
                  ? 'Connect Your Stripe Account' 
                  : 'Complete Your Stripe Connect Setup'}
              </AlertTitle>
              <AlertDescription className="text-amber-800 mt-2">
                <p className="mb-3">
                  {!stripeConnectStatus.hasAccount 
                    ? "Connect your Stripe Connect account to receive automatic payouts directly to your bank account. Without it, you'll need to wait for manual payouts."
                    : "Complete your Stripe Connect onboarding to start receiving automatic payouts. Finish the setup to avoid waiting for manual payouts."}
                </p>
                <Button
                  onClick={() => {
                    if (onNavigate) {
                      onNavigate('payments');
                    } else {
                      // Fallback: try to find and click the payments tab
                      const paymentsButton = document.querySelector('[data-view="payments"]');
                      if (paymentsButton) {
                        (paymentsButton as HTMLElement).click();
                      }
                    }
                  }}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                  size="sm"
                >
                  <CreditCard className="h-4 w-4 mr-2" />
                  {!stripeConnectStatus.hasAccount ? 'Set Up Stripe Connect' : 'Complete Setup'}
                  <ExternalLink className="h-3 w-3 ml-2" />
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {isLoadingPayouts ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            </div>
          ) : !payoutsData || payoutsData.payouts.length === 0 ? (
            <div className="text-center py-12">
              <CreditCard className="h-12 w-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No payouts yet</p>
              <p className="text-sm text-gray-400 mt-1">
                {stripeConnectStatus && !stripeConnectStatus.hasAccount 
                  ? "Connect Stripe Connect to start receiving automatic payouts"
                  : "Payouts will appear here once processed"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {payoutsData.payouts.map((payout: any) => (
                <div
                  key={payout.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-gray-50/50 hover:bg-gray-100/70 transition-colors duration-200"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                      <CreditCard className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatCurrency(payout.amount)} {payout.currency.toUpperCase()}
                      </p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{formatDate(payout.arrivalDate)}</span>
                        <span className="text-gray-300">•</span>
                        <span>{payout.method || 'Bank Transfer'}</span>
                        {payout.description && (
                          <>
                            <span className="text-gray-300">•</span>
                            <span>{payout.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPayoutStatusBadge(payout.status)}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadPayoutStatement(payout.id)}
                      className="h-8"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Statement
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={refundDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetRefundState();
          } else {
            setRefundDialogOpen(true);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Refund</DialogTitle>
            <DialogDescription>
              Refund a payment only if the payout has not started transferring to the bank.
            </DialogDescription>
          </DialogHeader>

          {!refundTarget ? (
            <div className="text-sm text-gray-500">Select a booking to refund.</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                <div className="font-semibold text-gray-900">
                  Booking #{refundTarget.id}
                </div>
                <div className="text-gray-600">
                  {refundTarget.kitchenName || refundTarget.locationName || 'Booking'}
                </div>
                {refundTarget.paymentIntentId && (
                  <div className="mt-1 text-xs text-gray-500">
                    PaymentIntent: {refundTarget.paymentIntentId}
                  </div>
                )}
              </div>

              {selectedEligibilityState?.isLoading && (
                <div className="text-sm text-gray-500">Checking refund eligibility...</div>
              )}

              {selectedEligibility && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Max refundable</span>
                    <span className="font-semibold">
                      {formatCurrency((selectedEligibility.maxRefundable || 0) / 100)}
                    </span>
                  </div>
                  {selectedEligibility.refundedAmount > 0 && (
                    <div className="mt-1 flex items-center justify-between text-gray-500">
                      <span>Already refunded</span>
                      <span>{formatCurrency(selectedEligibility.refundedAmount / 100)}</span>
                    </div>
                  )}
                  {selectedEligibility.payoutStatus && (
                    <div className="mt-1 flex items-center justify-between text-gray-500">
                      <span>Payout status</span>
                      <span className="capitalize">
                        {selectedEligibility.payoutStatus.replace('_', ' ')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {!selectedEligibility?.eligible && selectedEligibility?.blockReason && (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-900 font-semibold">
                    Refund not available
                  </AlertTitle>
                  <AlertDescription className="text-amber-800">
                    {selectedEligibility.blockReason}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Refund amount (CAD)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  placeholder="0.00"
                />
                {maxRefundableCents !== undefined && (
                  <p className="text-xs text-gray-500">
                    Max refundable: {formatCurrency(maxRefundableCents / 100)}
                  </p>
                )}
                {refundAmountExceedsMax && (
                  <p className="text-xs text-red-600">
                    Amount exceeds the maximum refundable amount.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Refund note
                </label>
                <Textarea
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Add a note for internal tracking"
                  rows={3}
                />
              </div>

              {refundError && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <AlertTitle className="text-red-900 font-semibold">
                    Refund failed
                  </AlertTitle>
                  <AlertDescription className="text-red-800">
                    {refundError}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button variant="ghost" onClick={resetRefundState} disabled={isRefundSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitRefund}
              disabled={refundActionDisabled}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isRefundSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing
                </span>
              ) : (
                'Issue Refund'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
