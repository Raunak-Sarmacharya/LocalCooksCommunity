/**
 * Pending Storage Checkouts Component
 * 
 * Manager view for reviewing storage checkout requests.
 * Industry-standard clear/claim flow (Airbnb/Turo model):
 * 1. Chef initiates checkout with photos
 * 2. Manager reviews photos and inspects storage (this component)
 * 3. Manager either clears (no issues) or files a damage/cleaning claim
 * 4. Auto-clears if manager takes no action within review window
 */

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { 
  CheckCircle, 
  Clock, 
  Package, 
  User, 
  Image,
  Loader2,
  AlertTriangle,
  MoreHorizontal,
  ArrowUpDown,
  MapPin,
  Eye,
  RefreshCw,
  ShieldCheck,
  FileWarning,
  Timer,
  DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingCheckout {
  storageBookingId: number;
  storageListingId: number;
  storageName: string;
  storageType: string;
  kitchenId: number;
  kitchenName: string;
  locationId: number;
  locationName: string;
  chefId: number | null;
  chefEmail: string | null;
  chefName: string | null;
  startDate: string;
  endDate: string;
  totalPrice: string;
  checkoutStatus: string;
  checkoutRequestedAt: string | null;
  checkoutApprovedAt?: string | null;
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  daysUntilEnd: number;
  isOverdue: boolean;
  reviewDeadline: string | null;
  isReviewExpired: boolean;
}

interface ClaimFormData {
  claimTitle: string;
  claimDescription: string;
  claimedAmountCents: number | '';
  damageDate: string;
  managerNotes: string;
}

const INITIAL_CLAIM_FORM: ClaimFormData = {
  claimTitle: '',
  claimDescription: '',
  claimedAmountCents: '',
  damageDate: new Date().toISOString().split('T')[0],
  managerNotes: '',
};

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return { 'Content-Type': 'application/json' };
}

// ─── Review Deadline Badge ────────────────────────────────────────────────────

function ReviewDeadlineBadge({ deadline, isExpired }: { deadline: string | null; isExpired: boolean }) {
  if (!deadline) return <span className="text-muted-foreground text-xs">—</span>;

  const deadlineDate = new Date(deadline);
  const now = Date.now();
  const isUrgent = !isExpired && !isPast(deadlineDate) && (deadlineDate.getTime() - now) < 30 * 60 * 1000; // < 30min

  if (isExpired || isPast(deadlineDate)) {
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs font-normal">
        <Timer className="h-3 w-3 mr-1" />
        Auto-clearing soon
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-normal",
        isUrgent
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-blue-50 text-blue-700 border-blue-200"
      )}
    >
      <Timer className="h-3 w-3 mr-1" />
      {formatDistanceToNow(deadlineDate, { addSuffix: false })} left
    </Badge>
  );
}

// ─── Column Definitions ───────────────────────────────────────────────────────

type ViewType = "pending" | "history";

interface CheckoutColumnsProps {
  onClear: (checkout: PendingCheckout) => void;
  onFileClaim: (checkout: PendingCheckout) => void;
  onViewPhotos: (checkout: PendingCheckout, index: number) => void;
  clearingId: number | null;
}

const getCheckoutColumns = ({
  onClear,
  onFileClaim,
  onViewPhotos,
  clearingId,
}: CheckoutColumnsProps): ColumnDef<PendingCheckout>[] => [
  {
    accessorKey: "storageName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Storage
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const checkout = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{checkout.storageName}</span>
            <Badge variant="outline" className="text-xs capitalize">
              {checkout.storageType}
            </Badge>
            {checkout.isOverdue && (
              <Badge variant="destructive" className="text-xs">
                Overdue
              </Badge>
            )}
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-3 w-3 mr-1" />
            <span>{checkout.locationName}</span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "chefEmail",
    header: "Chef",
    cell: ({ row }) => {
      const checkout = row.original;
      return (
        <div className="flex items-center gap-2 text-sm">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{checkout.chefEmail || 'Unknown'}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "checkoutRequestedAt",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Requested
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const requestedAt = row.getValue("checkoutRequestedAt") as string | null;
      if (!requestedAt) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex items-center text-sm text-muted-foreground">
          <Clock className="h-3 w-3 mr-2" />
          {formatDistanceToNow(new Date(requestedAt), { addSuffix: true })}
        </div>
      );
    },
  },
  {
    accessorKey: "reviewDeadline",
    header: "Review Window",
    cell: ({ row }) => {
      const checkout = row.original;
      return (
        <ReviewDeadlineBadge
          deadline={checkout.reviewDeadline}
          isExpired={checkout.isReviewExpired}
        />
      );
    },
  },
  {
    accessorKey: "checkoutPhotoUrls",
    header: "Photos",
    cell: ({ row }) => {
      const checkout = row.original;
      const photos = checkout.checkoutPhotoUrls;
      if (!photos || photos.length === 0) {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onViewPhotos(checkout, 0)}
                className="flex items-center gap-1 cursor-pointer hover:text-primary transition-colors"
              >
                <Image className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">{photos.length}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-sm">View {photos.length} photo{photos.length !== 1 ? 's' : ''}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const checkout = row.original;
      const isClearing = clearingId === checkout.storageBookingId;

      return (
        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-green-700 border-green-200 hover:bg-green-50 hover:text-green-800"
                  onClick={() => onClear(checkout)}
                  disabled={isClearing}
                >
                  {isClearing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  )}
                  <span className="ml-1.5 hidden lg:inline">Clear</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>No issues found — complete checkout</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewPhotos(checkout, 0)}>
                <Eye className="h-4 w-4 mr-2" />
                View Photos
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onClear(checkout)}
                disabled={isClearing}
                className="text-green-600 focus:text-green-600"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                Clear Storage — No Issues
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onFileClaim(checkout)}
                className="text-amber-600 focus:text-amber-600"
              >
                <FileWarning className="h-4 w-4 mr-2" />
                File Damage / Cleaning Claim
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  },
];

// ─── History Column Definitions ───────────────────────────────────────────────

const getHistoryColumns = (): ColumnDef<PendingCheckout>[] => [
  {
    accessorKey: "storageName",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        Storage
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const checkout = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{checkout.storageName}</span>
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-3 w-3 mr-1" />
            <span>{checkout.locationName}</span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "chefEmail",
    header: "Chef",
    cell: ({ row }) => (
      <span className="text-sm">{row.getValue("chefEmail") || 'Unknown'}</span>
    ),
  },
  {
    accessorKey: "checkoutStatus",
    header: "Result",
    cell: ({ row }) => {
      const status = row.getValue("checkoutStatus") as string;
      if (status === 'completed') {
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <ShieldCheck className="h-3 w-3 mr-1" />
            Cleared
          </Badge>
        );
      }
      if (status === 'checkout_claim_filed') {
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
            <FileWarning className="h-3 w-3 mr-1" />
            Claim Filed
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="capitalize">
          {status}
        </Badge>
      );
    },
  },
  {
    accessorKey: "checkoutApprovedAt",
    header: "Date",
    cell: ({ row }) => {
      const date = row.original.checkoutApprovedAt;
      if (!date) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-sm text-muted-foreground">
          {format(new Date(date), 'MMM d, yyyy')}
        </span>
      );
    },
  },
  {
    accessorKey: "checkoutNotes",
    header: "Notes",
    cell: ({ row }) => {
      const notes = row.getValue("checkoutNotes") as string | null;
      if (!notes) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-help truncate max-w-[200px] block">
                {notes}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{notes}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function PendingStorageCheckouts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCheckout, setSelectedCheckout] = useState<PendingCheckout | null>(null);
  const [claimSheetOpen, setClaimSheetOpen] = useState(false);
  const [claimForm, setClaimForm] = useState<ClaimFormData>(INITIAL_CLAIM_FORM);
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [viewType, setViewType] = useState<ViewType>("pending");
  const [sorting, setSorting] = useState<SortingState>([{ id: "checkoutRequestedAt", desc: true }]);

  const invalidateCheckoutQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/pending'] });
    queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/history'] });
  };

  // Fetch pending checkouts
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['/api/manager/storage-checkouts/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/storage-checkouts/pending', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch pending checkouts');
      return response.json();
    },
  });

  const pendingCheckouts: PendingCheckout[] = data?.pendingCheckouts || [];

  // Fetch checkout history
  const { data: historyData } = useQuery({
    queryKey: ['/api/manager/storage-checkouts/history'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/manager/storage-checkouts/history?limit=20', {
        headers,
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch checkout history');
      return response.json();
    },
    enabled: viewType === 'history',
  });

  const checkoutHistory: PendingCheckout[] = historyData?.checkoutHistory || [];

  // Clear mutation (no issues found)
  const clearMutation = useMutation({
    mutationFn: async (storageBookingId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/clear-checkout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to clear checkout');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Storage cleared",
        description: "No issues found. Checkout completed and chef has been notified.",
      });
      invalidateCheckoutQueries();
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Clear failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Start claim mutation (damage/cleaning issue found)
  const startClaimMutation = useMutation({
    mutationFn: async ({
      storageBookingId,
      claimTitle,
      claimDescription,
      claimedAmountCents,
      damageDate,
      managerNotes,
    }: {
      storageBookingId: number;
      claimTitle: string;
      claimDescription: string;
      claimedAmountCents: number;
      damageDate: string;
      managerNotes?: string;
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/start-claim`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ claimTitle, claimDescription, claimedAmountCents, damageDate, managerNotes }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start claim');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Claim filed",
        description: "Damage/cleaning claim created. The chef will be notified and can respond.",
      });
      invalidateCheckoutQueries();
      setClaimSheetOpen(false);
      setClaimForm(INITIAL_CLAIM_FORM);
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Claim failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handleClear = (checkout: PendingCheckout) => {
    clearMutation.mutate(checkout.storageBookingId);
  };

  const handleFileClaimClick = (checkout: PendingCheckout) => {
    setSelectedCheckout(checkout);
    setClaimForm(INITIAL_CLAIM_FORM);
    setClaimSheetOpen(true);
  };

  const handleClaimSubmit = () => {
    if (!selectedCheckout) return;

    if (!claimForm.claimTitle.trim() || claimForm.claimTitle.trim().length < 5) {
      toast({ title: "Title too short", description: "Claim title must be at least 5 characters.", variant: "destructive" });
      return;
    }
    if (!claimForm.claimDescription.trim() || claimForm.claimDescription.trim().length < 50) {
      toast({ title: "Description too short", description: "Claim description must be at least 50 characters.", variant: "destructive" });
      return;
    }
    if (!claimForm.claimedAmountCents || Number(claimForm.claimedAmountCents) <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid claim amount.", variant: "destructive" });
      return;
    }

    startClaimMutation.mutate({
      storageBookingId: selectedCheckout.storageBookingId,
      claimTitle: claimForm.claimTitle.trim(),
      claimDescription: claimForm.claimDescription.trim(),
      claimedAmountCents: Number(claimForm.claimedAmountCents),
      damageDate: claimForm.damageDate,
      managerNotes: claimForm.managerNotes.trim() || undefined,
    });
  };

  const openPhotoViewer = (checkout: PendingCheckout, index: number) => {
    setSelectedCheckout(checkout);
    setSelectedPhotoIndex(index);
    setPhotoViewerOpen(true);
  };

  // ─── Column Memos ─────────────────────────────────────────────────────────────

  const pendingColumns = useMemo(
    () => getCheckoutColumns({
      onClear: handleClear,
      onFileClaim: handleFileClaimClick,
      onViewPhotos: openPhotoViewer,
      clearingId: clearMutation.isPending ? (clearMutation.variables as number) : null,
    }),
    [clearMutation.isPending, clearMutation.variables]
  );

  const historyColumns = useMemo(() => getHistoryColumns(), []);

  // TanStack Table instances
  const pendingTable = useReactTable({
    data: pendingCheckouts,
    columns: pendingColumns,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { sorting },
  });

  const historyTable = useReactTable({
    data: checkoutHistory,
    columns: historyColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // ─── Render ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8 text-destructive">
          <AlertTriangle className="h-5 w-5 mr-2" />
          Failed to load pending checkouts
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-xl font-semibold flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-green-600" />
                Storage Checkouts
              </CardTitle>
              <CardDescription>
                {viewType === 'pending' 
                  ? `${pendingCheckouts.length} pending checkout review${pendingCheckouts.length !== 1 ? 's' : ''}`
                  : `${checkoutHistory.length} checkout${checkoutHistory.length !== 1 ? 's' : ''} in history`}
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* View Type Tabs */}
          <Tabs value={viewType} onValueChange={(v) => setViewType(v as ViewType)} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="pending" className="gap-2">
                <Clock className="h-4 w-4" />
                Pending Review
                {pendingCheckouts.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{pendingCheckouts.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2">
                <CheckCircle className="h-4 w-4" />
                History
                {checkoutHistory.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{checkoutHistory.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Pending Table */}
          {viewType === 'pending' && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  {pendingTable.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {pendingTable.getRowModel().rows?.length ? (
                    pendingTable.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className={cn(
                          "hover:bg-muted/50",
                          row.original.isOverdue && "bg-amber-50/50",
                          row.original.isReviewExpired && "bg-orange-50/30"
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={pendingColumns.length} className="h-48 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <ShieldCheck className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">No Pending Reviews</p>
                          <p className="text-sm text-muted-foreground">
                            Storage checkout requests from chefs will appear here for review
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* History Table */}
          {viewType === 'history' && (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  {historyTable.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} className="whitespace-nowrap">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {historyTable.getRowModel().rows?.length ? (
                    historyTable.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        className={cn(
                          "hover:bg-muted/50",
                          row.original.checkoutStatus === 'completed' && "bg-green-50/20",
                          row.original.checkoutStatus === 'checkout_claim_filed' && "bg-amber-50/20"
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={historyColumns.length} className="h-48 text-center">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Clock className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">No Checkout History</p>
                          <p className="text-sm text-muted-foreground">
                            Completed checkout reviews will appear here
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── File Claim Sheet ──────────────────────────────────────────────────── */}
      <Sheet open={claimSheetOpen} onOpenChange={setClaimSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-600" />
              File Damage / Cleaning Claim
            </SheetTitle>
            <SheetDescription>
              Document the issue and file a claim. The chef will be notified and can respond or dispute.
            </SheetDescription>
          </SheetHeader>

          {selectedCheckout && (
            <div className="space-y-4 py-4">
              {/* Booking context */}
              <div className="bg-muted/50 rounded-lg p-3 space-y-1">
                <div className="text-sm font-medium">{selectedCheckout.storageName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {selectedCheckout.chefEmail || 'Unknown chef'}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {selectedCheckout.locationName}
                </div>
              </div>

              <Separator />

              {/* Claim Title */}
              <div className="space-y-1.5">
                <Label htmlFor="claim-title">Claim Title *</Label>
                <Input
                  id="claim-title"
                  placeholder="e.g., Food residue left in storage unit"
                  value={claimForm.claimTitle}
                  onChange={(e) => setClaimForm(prev => ({ ...prev, claimTitle: e.target.value }))}
                  maxLength={200}
                />
                <p className="text-xs text-muted-foreground">Minimum 5 characters</p>
              </div>

              {/* Claim Description */}
              <div className="space-y-1.5">
                <Label htmlFor="claim-desc">Description *</Label>
                <Textarea
                  id="claim-desc"
                  placeholder="Describe the damage or cleaning issue in detail. Include what you observed, the condition of the storage unit, and any relevant context..."
                  value={claimForm.claimDescription}
                  onChange={(e) => setClaimForm(prev => ({ ...prev, claimDescription: e.target.value }))}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  {claimForm.claimDescription.length}/50 minimum characters
                </p>
              </div>

              {/* Claimed Amount */}
              <div className="space-y-1.5">
                <Label htmlFor="claim-amount">Claim Amount (CAD) *</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="claim-amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="pl-9"
                    value={claimForm.claimedAmountCents ? (Number(claimForm.claimedAmountCents) / 100).toFixed(2) : ''}
                    onChange={(e) => {
                      const dollars = parseFloat(e.target.value);
                      setClaimForm(prev => ({
                        ...prev,
                        claimedAmountCents: isNaN(dollars) ? '' : Math.round(dollars * 100),
                      }));
                    }}
                  />
                </div>
              </div>

              {/* Damage Date */}
              <div className="space-y-1.5">
                <Label htmlFor="damage-date">Date of Damage/Issue</Label>
                <Input
                  id="damage-date"
                  type="date"
                  value={claimForm.damageDate}
                  onChange={(e) => setClaimForm(prev => ({ ...prev, damageDate: e.target.value }))}
                />
              </div>

              {/* Manager Notes */}
              <div className="space-y-1.5">
                <Label htmlFor="manager-notes">Internal Notes (optional)</Label>
                <Textarea
                  id="manager-notes"
                  placeholder="Internal notes for your reference..."
                  value={claimForm.managerNotes}
                  onChange={(e) => setClaimForm(prev => ({ ...prev, managerNotes: e.target.value }))}
                  rows={2}
                />
              </div>

              {/* Info box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-blue-700">
                    <strong>What happens next</strong>
                    <ul className="mt-1 space-y-0.5 list-disc list-inside">
                      <li>The chef will be notified and has 72 hours to respond</li>
                      <li>They can accept the claim or dispute it</li>
                      <li>You can add photo evidence after filing</li>
                      <li>Storage is released — the claim is tracked separately</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          <SheetFooter className="mt-2">
            <Button variant="outline" onClick={() => setClaimSheetOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleClaimSubmit}
              disabled={startClaimMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {startClaimMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileWarning className="h-4 w-4 mr-2" />
              )}
              File Claim
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* ─── Photo Viewer Sheet ────────────────────────────────────────────────── */}
      <Sheet open={photoViewerOpen} onOpenChange={setPhotoViewerOpen}>
        <SheetContent className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Checkout Photos</SheetTitle>
          </SheetHeader>
          {selectedCheckout && selectedCheckout.checkoutPhotoUrls.length > 0 && (
            <div className="space-y-4 mt-4">
              <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
                <img
                  src={getR2ProxyUrl(selectedCheckout.checkoutPhotoUrls[selectedPhotoIndex])}
                  alt={`Photo ${selectedPhotoIndex + 1}`}
                  className="w-full h-full object-contain"
                />
              </div>
              {selectedCheckout.checkoutPhotoUrls.length > 1 && (
                <div className="flex justify-center gap-2">
                  {selectedCheckout.checkoutPhotoUrls.map((url, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedPhotoIndex(index)}
                      className={cn(
                        "w-12 h-12 rounded overflow-hidden border-2 transition-colors",
                        index === selectedPhotoIndex ? "border-primary" : "border-transparent"
                      )}
                    >
                      <img
                        src={getR2ProxyUrl(url)}
                        alt={`Thumbnail ${index + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              {/* Quick action buttons below photos */}
              <Separator />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-green-700 border-green-200 hover:bg-green-50"
                  onClick={() => {
                    setPhotoViewerOpen(false);
                    handleClear(selectedCheckout);
                  }}
                  disabled={clearMutation.isPending}
                >
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Clear — No Issues
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-amber-700 border-amber-200 hover:bg-amber-50"
                  onClick={() => {
                    setPhotoViewerOpen(false);
                    handleFileClaimClick(selectedCheckout);
                  }}
                >
                  <FileWarning className="h-4 w-4 mr-2" />
                  File Claim
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
