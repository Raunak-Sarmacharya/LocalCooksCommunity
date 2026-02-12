import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Clock, Check, X, Package, ChevronRight, AlertCircle, RefreshCw, ArrowUpDown } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getAuthHeaders } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

interface PendingExtension {
  id: number;
  storageBookingId: number;
  newEndDate: string;
  extensionDays: number;
  extensionBasePriceCents: number;
  extensionTotalPriceCents: number;
  status: string;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  currentEndDate: string;
  storageName: string;
  storageType: string;
  kitchenName: string;
}

// Column definitions for extension requests table
const getExtensionColumns = (
  syncMutation: ReturnType<typeof useMutation<any, Error, number>>
): ColumnDef<PendingExtension>[] => [
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
      const extension = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{extension.storageName}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 ml-5">
            at {extension.kitchenName}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "extensionDays",
    header: "Extension",
    cell: ({ row }) => {
      const extension = row.original;
      return (
        <div className="flex items-center gap-2 text-sm">
          <div className="bg-gray-100 rounded px-2 py-1">
            <span className="text-gray-600 text-xs">Current: </span>
            <span className="font-medium text-xs">{format(new Date(extension.currentEndDate), "MMM d")}</span>
          </div>
          <ChevronRight className="h-3 w-3 text-gray-400" />
          <div className="bg-green-100 rounded px-2 py-1">
            <span className="text-green-700 text-xs">New: </span>
            <span className="font-medium text-green-800 text-xs">{format(new Date(extension.newEndDate), "MMM d")}</span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "extensionTotalPriceCents",
    header: "Amount",
    cell: ({ row }) => {
      const extension = row.original;
      return (
        <div className="text-sm">
          <div className="font-medium">${(extension.extensionTotalPriceCents / 100).toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">{extension.extensionDays} day{extension.extensionDays > 1 ? 's' : ''}</div>
        </div>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      const extension = row.original;

      const getStatusBadge = () => {
        switch (status) {
          case 'pending':
            return (
              <Badge variant="outline" className="text-muted-foreground">
                <Clock className="h-3 w-3 mr-1" />
                Awaiting Payment
              </Badge>
            );
          case 'paid':
            return (
              <Badge variant="warning">
                <Clock className="h-3 w-3 mr-1" />
                Awaiting Approval
              </Badge>
            );
          case 'approved':
          case 'completed':
            return (
              <Badge variant="success">
                <Check className="h-3 w-3 mr-1" />
                Approved
              </Badge>
            );
          case 'rejected':
            return (
              <Badge variant="outline" className="text-destructive border-destructive/30">
                <X className="h-3 w-3 mr-1" />
                Rejected
              </Badge>
            );
          case 'refunded':
            return (
              <Badge variant="info">
                <Check className="h-3 w-3 mr-1" />
                Refunded
              </Badge>
            );
          default:
            return (
              <Badge variant="outline" className="capitalize">
                {status}
              </Badge>
            );
        }
      };

      return (
        <div className="flex flex-col gap-1">
          {getStatusBadge()}
          {extension.rejectionReason && (status === 'rejected' || status === 'refunded') && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center text-xs text-red-600 cursor-help">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    View reason
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-sm">{extension.rejectionReason}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: "createdAt",
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
      return (
        <div className="text-sm text-muted-foreground">
          {format(new Date(row.getValue("createdAt")), "MMM d, yyyy")}
        </div>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const extension = row.original;
      const isPending = extension.status === 'pending';

      if (!isPending) return null;

      return (
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncMutation.mutate(extension.id)}
          disabled={syncMutation.isPending}
          className="text-xs"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          {syncMutation.isPending ? 'Checking...' : 'Sync'}
        </Button>
      );
    },
  },
];

export function PendingStorageExtensions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: extensions, isLoading } = useQuery({
    queryKey: ['/api/chef/storage-extensions/pending'],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/chef/storage-extensions/pending', { headers });
      if (!response.ok) {
        throw new Error('Failed to fetch pending extensions');
      }
      return response.json() as Promise<PendingExtension[]>;
    },
  });

  // Sync mutation for when webhook doesn't fire
  const syncMutation = useMutation({
    mutationFn: async (extensionId: number) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/storage-extensions/${extensionId}/sync`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to sync');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-extensions/pending'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/storage-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/chef/bookings'] });
      
      if (data.status === 'paid') {
        toast({
          title: "Status Updated",
          description: "Your extension is now awaiting manager approval.",
        });
      } else if (data.status === 'expired') {
        toast({
          title: "Session Expired",
          description: "The payment session has expired. Please try again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Status Checked",
          description: data.message || "No changes needed.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Filter to show only active extensions
  const activeExtensions = useMemo(() => 
    extensions?.filter(ext => 
      ext.status === 'pending' || ext.status === 'paid' || ext.status === 'rejected' || ext.status === 'refunded'
    ) || [],
    [extensions]
  );

  // Column definitions
  const columns = useMemo(
    () => getExtensionColumns(syncMutation),
    [syncMutation]
  );

  // TanStack Table instance
  const table = useReactTable({
    data: activeExtensions,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (isLoading) {
    return null;
  }

  if (activeExtensions.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5 text-amber-600" />
          Storage Extension Requests
        </CardTitle>
        <CardDescription>
          {activeExtensions.length} pending extension request{activeExtensions.length !== 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border bg-white">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
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
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={`hover:bg-muted/50 ${
                      row.original.status === 'rejected' ? 'bg-red-50/50' : ''
                    }`}
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
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Package className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No extension requests</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
