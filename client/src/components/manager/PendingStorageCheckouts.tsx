/**
 * Pending Storage Checkouts Component
 * 
 * Manager view for reviewing and approving/denying storage checkout requests.
 * Uses TanStack Table for enterprise-grade table display.
 * Part of the hybrid verification system:
 * 1. Chef initiates checkout with photos
 * 2. Manager reviews photos and verifies (this component)
 * 3. Manager approves or denies with reason
 * 4. Prevents unwarranted overstay penalties
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
  XCircle, 
  Clock, 
  Package, 
  User, 
  Calendar,
  Image,
  Loader2,
  AlertTriangle,
  MoreHorizontal,
  ArrowUpDown,
  MapPin,
  Eye,
  RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { format, formatDistanceToNow } from "date-fns";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

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
  checkoutDeniedAt?: string | null;
  checkoutDenialReason?: string | null;
  checkoutNotes: string | null;
  checkoutPhotoUrls: string[];
  daysUntilEnd: number;
  isOverdue: boolean;
}

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

// Column definitions for pending checkouts table
type ViewType = "pending" | "history";

interface CheckoutColumnsProps {
  onApprove: (checkout: PendingCheckout) => void;
  onDeny: (checkout: PendingCheckout) => void;
  onViewPhotos: (checkout: PendingCheckout, index: number) => void;
  approvingId: number | null;
}

const getCheckoutColumns = ({
  onApprove,
  onDeny,
  onViewPhotos,
  approvingId,
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
    accessorKey: "endDate",
    header: ({ column }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="h-8 -ml-3"
      >
        End Date
        <ArrowUpDown className="ml-2 h-3 w-3" />
      </Button>
    ),
    cell: ({ row }) => {
      const checkout = row.original;
      return (
        <div className="flex items-center text-sm">
          <Calendar className="h-3 w-3 mr-2 text-muted-foreground" />
          {format(new Date(checkout.endDate), 'MMM d, yyyy')}
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
      const isApproving = approvingId === checkout.storageBookingId;

      return (
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
              onClick={() => onApprove(checkout)}
              disabled={isApproving}
              className="text-green-600 focus:text-green-600"
            >
              {isApproving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-2" />
              )}
              Approve Checkout
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDeny(checkout)}
              className="text-destructive focus:text-destructive"
            >
              <XCircle className="h-4 w-4 mr-2" />
              Deny Checkout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

// History columns
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
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("checkoutStatus") as string;
      if (status === 'completed') {
        return (
          <Badge variant="outline" className="bg-green-100 text-green-700 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
          <XCircle className="h-3 w-3 mr-1" />
          Denied
        </Badge>
      );
    },
  },
  {
    accessorKey: "checkoutApprovedAt",
    header: "Date",
    cell: ({ row }) => {
      const checkout = row.original;
      const date = checkout.checkoutStatus === 'completed' 
        ? checkout.checkoutApprovedAt 
        : checkout.checkoutDeniedAt;
      if (!date) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-sm text-muted-foreground">
          {format(new Date(date), 'MMM d, yyyy')}
        </span>
      );
    },
  },
  {
    accessorKey: "checkoutDenialReason",
    header: "Reason",
    cell: ({ row }) => {
      const reason = row.getValue("checkoutDenialReason") as string | null;
      if (!reason) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-amber-700 cursor-help truncate max-w-[150px] block">
                {reason}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">{reason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    },
  },
];

export function PendingStorageCheckouts() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCheckout, setSelectedCheckout] = useState<PendingCheckout | null>(null);
  const [denyDialogOpen, setDenyDialogOpen] = useState(false);
  const [denialReason, setDenialReason] = useState("");
  const [photoViewerOpen, setPhotoViewerOpen] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const [viewType, setViewType] = useState<ViewType>("pending");
  const [sorting, setSorting] = useState<SortingState>([{ id: "checkoutRequestedAt", desc: true }]);

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

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: async (storageBookingId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/approve-checkout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve checkout');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Checkout approved",
        description: "The storage booking has been completed. The chef has been notified.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/history'] });
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Approval failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Deny mutation
  const denyMutation = useMutation({
    mutationFn: async ({ storageBookingId, denialReason }: { storageBookingId: number; denialReason: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/manager/storage-bookings/${storageBookingId}/deny-checkout`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ denialReason }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to deny checkout');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Checkout denied",
        description: "The chef has been notified to address the issues.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/manager/storage-checkouts/history'] });
      setDenyDialogOpen(false);
      setDenialReason("");
      setSelectedCheckout(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Denial failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleApprove = (checkout: PendingCheckout) => {
    approveMutation.mutate(checkout.storageBookingId);
  };

  const handleDenyClick = (checkout: PendingCheckout) => {
    setSelectedCheckout(checkout);
    setDenyDialogOpen(true);
  };

  const handleDenySubmit = () => {
    if (!selectedCheckout || !denialReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for denying the checkout",
        variant: "destructive",
      });
      return;
    }
    denyMutation.mutate({
      storageBookingId: selectedCheckout.storageBookingId,
      denialReason: denialReason.trim(),
    });
  };

  const openPhotoViewer = (checkout: PendingCheckout, index: number) => {
    setSelectedCheckout(checkout);
    setSelectedPhotoIndex(index);
    setPhotoViewerOpen(true);
  };

  // Column definitions
  const pendingColumns = useMemo(
    () => getCheckoutColumns({
      onApprove: handleApprove,
      onDeny: handleDenyClick,
      onViewPhotos: openPhotoViewer,
      approvingId: approveMutation.isPending ? (approveMutation.variables as number) : null,
    }),
    [approveMutation.isPending, approveMutation.variables]
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
                <CheckCircle className="h-5 w-5 text-green-600" />
                Storage Checkouts
              </CardTitle>
              <CardDescription>
                {viewType === 'pending' 
                  ? `${pendingCheckouts.length} pending checkout request${pendingCheckouts.length !== 1 ? 's' : ''}`
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
                Pending
                <Badge variant="secondary" className="ml-1">{pendingCheckouts.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-2">
                <CheckCircle className="h-4 w-4" />
                History
                <Badge variant="secondary" className="ml-1">{checkoutHistory.length}</Badge>
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
                          row.original.isOverdue && "bg-amber-50/50"
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
                          <Package className="h-8 w-8 text-muted-foreground" />
                          <p className="text-sm font-medium">No Pending Checkouts</p>
                          <p className="text-sm text-muted-foreground">
                            Checkout requests from chefs will appear here
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
                          row.original.checkoutStatus === 'completed' && "bg-green-50/30"
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
                            Completed checkouts will appear here
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

      {/* Deny Sheet */}
      <Sheet open={denyDialogOpen} onOpenChange={setDenyDialogOpen}>
        <SheetContent className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Deny Checkout Request</SheetTitle>
            <SheetDescription>
              Please provide a reason for denying this checkout. The chef will be notified and can submit a new request after addressing the issues.
            </SheetDescription>
          </SheetHeader>
          <div className="py-4">
            <Label htmlFor="denial-reason">Reason for Denial *</Label>
            <Textarea
              id="denial-reason"
              placeholder="e.g., Storage unit still contains items, needs cleaning..."
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              rows={3}
              className="mt-2"
            />
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setDenyDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDenySubmit}
              disabled={denyMutation.isPending || !denialReason.trim()}
            >
              {denyMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Deny Checkout
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Photo Viewer Sheet */}
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
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
