/**
 * Storage Check-In History Component
 *
 * Manager view for browsing completed storage move-in inspections.
 * Storage check-ins are auto-approved by the chef — no manager review
 * is required. This page shows the historical record for reference.
 *
 * Check-in photos persist on the booking and are auto-linked as
 * `photo_before` evidence to any damage claim filed at checkout.
 */

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
  Image as ImageIcon,
  Loader2,
  ArrowUpDown,
  MapPin,
  Eye,
  RefreshCw,
  LogIn,
  SkipForward,
  ClipboardCheck,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingCheckin {
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
  checkinStatus: string;
  checkinRequestedAt: string | null;
  checkinCompletedAt: string | null;
  checkinNotes: string | null;
  checkinPhotoUrls: string[];
  checkinChecklistItems: Array<{ id: string; label: string; checked: boolean }>;
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
  return { "Content-Type": "application/json" };
}

// ─── History Column Definitions ───────────────────────────────────────────────

interface HistoryColumnsProps {
  onViewDetails: (checkin: PendingCheckin) => void;
}

const getCheckinHistoryColumns = ({
  onViewDetails,
}: HistoryColumnsProps): ColumnDef<PendingCheckin>[] => [
  {
    id: "reference",
    header: "Ref",
    cell: ({ row }) => {
      const ref = row.original.referenceCode || row.original.id;
      return (
        <div className="font-mono text-xs text-muted-foreground whitespace-nowrap">
          {ref ? `#${ref}` : "—"}
        </div>
      );
    },
  },
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
      const checkin = row.original;
      return (
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="font-medium text-sm">{checkin.storageName}</span>
          </div>
          <div className="flex items-center text-xs text-muted-foreground mt-0.5 ml-5">
            <MapPin className="h-2.5 w-2.5 mr-1" />
            {checkin.kitchenName} · {checkin.locationName}
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "chefName",
    header: "Chef",
    cell: ({ row }) => (
      <span className="text-sm">{row.getValue("chefName") || "—"}</span>
    ),
  },
  {
    accessorKey: "checkinStatus",
    header: "Result",
    cell: ({ row }) => {
      const status = row.getValue("checkinStatus") as string;
      if (status === "checkin_completed") {
        return (
          <Badge variant="success">
            <CheckCircle className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      }
      if (status === "skipped") {
        return (
          <Badge variant="outline">
            <SkipForward className="h-3 w-3 mr-1" />
            Skipped
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
    accessorKey: "checkinCompletedAt",
    header: "Date",
    cell: ({ row }) => {
      const date = row.original.checkinCompletedAt;
      if (!date) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-sm text-muted-foreground">
          {format(new Date(date), "MMM d, yyyy")}
        </span>
      );
    },
  },
  {
    accessorKey: "checkinNotes",
    header: "Notes",
    cell: ({ row }) => {
      const notes = row.getValue("checkinNotes") as string | null;
      if (!notes) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <span className="text-xs text-muted-foreground truncate max-w-[200px] block" title={notes}>
          {notes}
        </span>
      );
    },
  },
  {
    id: "evidence",
    header: "Evidence",
    cell: ({ row }) => {
      const checkin = row.original;
      const photoCount = checkin.checkinPhotoUrls?.length || 0;
      const checklistCount = checkin.checkinChecklistItems?.filter(
        (i) => i.checked,
      ).length;
      return (
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="h-3 w-3 text-muted-foreground" />
            {photoCount} photo{photoCount !== 1 ? "s" : ""}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClipboardCheck className="h-3 w-3 text-muted-foreground" />
            {checklistCount ?? 0} checked
          </span>
        </div>
      );
    },
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => {
      const checkin = row.original;
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => onViewDetails(checkin)}
        >
          <Eye className="h-3 w-3 mr-1" />
          View
        </Button>
      );
    },
  },
];

// ─── Read-Only Detail Sheet ─────────────────────────────────────────────────────

function CheckinDetailSheet({
  checkin,
  open,
  onOpenChange,
}: {
  checkin: PendingCheckin | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!checkin) return null;
  const submittedAt = checkin.checkinRequestedAt
    ? new Date(checkin.checkinRequestedAt)
    : null;
  const completedAt = checkin.checkinCompletedAt
    ? new Date(checkin.checkinCompletedAt)
    : null;
  const isSkipped = checkin.checkinStatus === "skipped";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5 text-emerald-600" />
            Move-In Inspection Details
          </SheetTitle>
          <SheetDescription>
            {checkin.storageName} · {checkin.kitchenName} ·{" "}
            {checkin.locationName}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          {/* Chef + timestamps */}
          <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">
                {checkin.chefName || "Chef"}
              </span>
              <span className="text-xs text-muted-foreground">
                {checkin.chefEmail || ""}
              </span>
            </div>
            {submittedAt && (
              <div className="text-xs text-muted-foreground">
                Submitted {format(submittedAt, "MMM d, yyyy 'at' h:mm a")} (
                {formatDistanceToNow(submittedAt, { addSuffix: true })})
              </div>
            )}
            {completedAt && (
              <div className="text-xs text-muted-foreground">
                {isSkipped ? "Skipped" : "Completed"}{" "}
                {format(completedAt, "MMM d, yyyy 'at' h:mm a")}
              </div>
            )}
            <div>
              {isSkipped ? (
                <Badge variant="outline">
                  <SkipForward className="h-3 w-3 mr-1" />
                  Skipped
                </Badge>
              ) : (
                <Badge variant="success">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Completed
                </Badge>
              )}
            </div>
          </div>

          {/* Checklist */}
          {checkin.checkinChecklistItems?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-semibold">Checklist</h3>
              </div>
              <div className="rounded-lg border divide-y">
                {checkin.checkinChecklistItems.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2 p-2 text-sm"
                  >
                    <CheckCircle
                      className={`h-4 w-4 mt-0.5 flex-shrink-0 ${
                        item.checked
                          ? "text-emerald-600"
                          : "text-muted-foreground/40"
                      }`}
                    />
                    <span className="tabular-nums text-sm font-medium text-muted-foreground">{index + 1}.</span>
                    <span
                      className={
                        item.checked ? "" : "text-muted-foreground line-through"
                      }
                    >
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Photos gallery */}
          {checkin.checkinPhotoUrls?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-semibold">
                  Baseline Photos ({checkin.checkinPhotoUrls.length})
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {checkin.checkinPhotoUrls.map((url, i) => (
                  <a
                    key={i}
                    href={getR2ProxyUrl(url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group relative aspect-square overflow-hidden rounded-lg border bg-muted/30"
                  >
                    <img
                      src={getR2ProxyUrl(url)}
                      alt={`Check-in photo ${i + 1}`}
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                    <div className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      {i + 1}
                    </div>
                  </a>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                These photos are auto-attached as <em>photo_before</em>{" "}
                evidence to any damage claim filed at checkout.
              </p>
            </div>
          )}

          {/* Notes */}
          {checkin.checkinNotes && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Chef Notes</h3>
              <div className="rounded-lg border p-3 text-sm whitespace-pre-line">
                {checkin.checkinNotes}
              </div>
            </div>
          )}

          {/* No evidence notice for skipped */}
          {isSkipped && !checkin.checkinPhotoUrls?.length && !checkin.checkinChecklistItems?.length && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <p>
                This check-in was skipped. No baseline photos or checklist were
                recorded, so damage claims at checkout will not have move-in
                evidence.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PendingStorageCheckins() {
  const [historySelected, setHistorySelected] = useState<PendingCheckin | null>(null);

  // Fetch check-in history
  const { data: historyData, isLoading, refetch } = useQuery({
    queryKey: ["/api/manager/storage-checkins/history"],
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/manager/storage-checkins/history?limit=20", {
        headers,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch check-in history");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  const checkinHistory: PendingCheckin[] = historyData?.checkinHistory || [];

  const historyColumns = useMemo(
    () => getCheckinHistoryColumns({ onViewDetails: (c: PendingCheckin) => setHistorySelected(c) }),
    [],
  );

  const historyTable = useReactTable({
    data: checkinHistory,
    columns: historyColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-xl font-semibold flex items-center gap-2">
              <LogIn className="h-5 w-5 text-emerald-600" />
              Storage Check-In History
            </CardTitle>
            <CardDescription>
              {checkinHistory.length} completed move-in inspection{checkinHistory.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="shrink-0"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <Table>
              <TableHeader>
                {historyTable.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id} className="text-xs">
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {historyTable.getRowModel().rows.length ? (
                  historyTable.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className={cn(
                        "hover:bg-muted/50",
                        row.original.checkinStatus === "checkin_completed" && "bg-green-50/20",
                        row.original.checkinStatus === "skipped" && "bg-muted/10"
                      )}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id} className="py-2">
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={historyColumns.length}
                      className="h-32 text-center"
                    >
                      <div className="flex flex-col items-center gap-2 py-6">
                        <Clock className="h-8 w-8 text-muted-foreground/60" />
                        <p className="text-sm font-medium">
                          No Check-In History
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Completed and skipped check-ins will appear here
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

      <CheckinDetailSheet
        checkin={historySelected}
        open={historySelected !== null}
        onOpenChange={(open: boolean) => !open && setHistorySelected(null)}
      />
    </Card>
  );
}
