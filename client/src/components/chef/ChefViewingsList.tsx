import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ColumnDef,
  ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
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
  Loader2,
  Eye,
  ChevronDown,
  ChevronRight,
  MapPin,
  MessageSquare,
} from "lucide-react";
import { DEFAULT_TIMEZONE } from "@/utils/timezone-utils";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { tt } from "@/i18n/common-ns";
import {
  ChefTourRow,
  chefTourRowHasDetails,
  formatTourWhen,
  normalizeChefTourRow,
  viewingStatusBadge,
} from "@/lib/chef-viewing-display";

function getTourColumns(
  t: (key: string, defaultValue?: string | Record<string, unknown>) => string
): ColumnDef<ChefTourRow>[] {
  return [
    {
      id: "expand",
      header: () => null,
      enableSorting: false,
      cell: ({ row }) => {
        if (!chefTourRowHasDetails(row.original)) return null;
        return (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
          >
            {row.getIsExpanded() ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        );
      },
    },
    {
      accessorKey: "locationName",
      header: () => t("tourColKitchen", "Kitchen"),
      cell: ({ row }) => {
        const tour = row.original;
        return (
          <div className="min-w-0 max-w-[220px]">
            <p className="font-medium text-foreground truncate">{tour.locationName}</p>
            {tour.kitchenName ? (
              <p className="text-xs text-muted-foreground truncate">{tour.kitchenName}</p>
            ) : tour.locationAddress ? (
              <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{tour.locationAddress}</span>
              </p>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "scheduledAt",
      header: () => t("tourColWhen", "When"),
      cell: ({ row }) => {
        const tour = row.original;
        return (
          <div className="whitespace-nowrap">
            <p className="font-medium text-foreground">
              {formatTourWhen(tour.scheduledAt, null, DEFAULT_TIMEZONE)}
            </p>
            <p className="text-xs text-muted-foreground">
              {tour.durationMinutes
                ? t("tourListDurationMins", {
                    count: tour.durationMinutes,
                    defaultValue: `${tour.durationMinutes} min`,
                  })
                : t("tourListDurationDefault", "About 30 min")}
            </p>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: () => t("tourColStatus", "Status"),
      cell: ({ row }) => {
        const badge = viewingStatusBadge(row.original.status);
        return (
          <Badge variant={badge.variant} className="text-[10px] uppercase tracking-wide">
            {t(badge.labelKey, badge.defaultLabel)}
          </Badge>
        );
      },
    },
    {
      id: "notes",
      header: () => t("tourColNotes", "Notes"),
      enableSorting: false,
      cell: ({ row }) => {
        const notes = row.original.chefNotes?.trim();
        if (!notes) {
          return <span className="text-xs text-muted-foreground">—</span>;
        }
        return (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground max-w-[160px]">
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span className="truncate">{notes}</span>
          </span>
        );
      },
    },
    {
      id: "actions",
      header: () => null,
      enableSorting: false,
      cell: ({ row }) => {
        const locationId = row.original.locationId;
        if (locationId == null) return null;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <Button variant="outline" size="sm" className="h-8" asChild>
              <Link href={`/kitchen-preview/${locationId}`}>
                <Eye className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("tourListViewKitchen", "View Kitchen")}</span>
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];
}

function TourDetailPanel({
  tour,
  t,
}: {
  tour: ChefTourRow;
  t: (key: string, defaultValue?: string | Record<string, unknown>) => string;
}) {
  return (
    <div className="space-y-2 text-sm px-1 py-1">
      {tour.locationAddress && (
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{tour.locationAddress}</span>
        </p>
      )}

      {tour.chefNotes?.trim() && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
            {t("tourListYourNotes", "Your notes")}
          </p>
          <p className="text-foreground whitespace-pre-wrap">{tour.chefNotes.trim()}</p>
        </div>
      )}

      {tour.intakeEntries.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("tourListIntakeTitle", "What you shared")}
          </p>
          {tour.intakeEntries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-xs sm:text-sm">
              <span className="text-muted-foreground capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="font-medium text-foreground text-right">
                {typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tour.status === "pending" && (
        <p className="text-amber-900 bg-amber-50 border border-amber-200/80 rounded-md px-2.5 py-1.5 text-xs sm:text-sm">
          {t(
            "tourListPendingNext",
            "Waiting for the kitchen to confirm. You’ll get an email when they approve this tour."
          )}
        </p>
      )}

      {tour.status === "confirmed" && (
        <p className="text-emerald-950 bg-emerald-50 border border-emerald-200/80 rounded-md px-2.5 py-1.5 text-xs sm:text-sm">
          {t(
            "tourListConfirmedNext",
            "Tour confirmed. Arrive on time — bring questions about equipment, storage, and access."
          )}
        </p>
      )}

      {tour.cancellationReason && (
        <div>
          <p className="font-medium text-destructive text-xs mb-0.5">
            {t("tourListCancelReason", "Cancellation reason")}
          </p>
          <p className="text-muted-foreground">{tour.cancellationReason}</p>
        </div>
      )}

      {tour.managerNotes && (
        <div>
          <p className="font-medium text-foreground text-xs mb-0.5">
            {t("tourListManagerMessage", {
              name: tour.managerName || "Manager",
              defaultValue: `Message from ${tour.managerName || "Manager"}`,
            })}
          </p>
          <p className="text-muted-foreground">{tour.managerNotes}</p>
        </div>
      )}
    </div>
  );
}

export default function ChefViewingsList({ onExploreKitchens }: { onExploreKitchens?: () => void }) {
  const { user } = useFirebaseAuth();
  const { t } = useTranslation("chef");
  const [sorting, setSorting] = useState<SortingState>([{ id: "scheduledAt", desc: true }]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const { data: rawViewings = [], isLoading } = useQuery({
    queryKey: ["/api/viewings", "chef", user?.uid],
    queryFn: async () => {
      if (!user) return [];
      try {
        const token = await auth.currentUser?.getIdToken();
        const res = await fetch("/api/viewings/chef", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(tt("failedToFetchViewings"));
        return res.json();
      } catch (error) {
        console.error(error);
        return [];
      }
    },
    enabled: !!user?.uid,
  });

  const data = useMemo(
    () =>
      (rawViewings as unknown[])
        .map(normalizeChefTourRow)
        .filter((row): row is ChefTourRow => row != null),
    [rawViewings]
  );

  const columns = useMemo(() => getTourColumns(t as any), [t]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => chefTourRowHasDetails(row.original),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="border-dashed shadow-none" data-testid="chef-viewings-list-empty">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <Eye className="mb-4 h-6 w-6 text-muted-foreground" />
          <h3 className="text-lg font-medium">
            {t("tourListEmptyTitle", "No kitchen tours yet")}
          </h3>
          <p className="text-muted-foreground mt-1 max-w-sm">
            {t(
              "tourListEmptyBody",
              "Request a tour from Discover to walk a kitchen before you apply."
            )}
          </p>
          {onExploreKitchens && (
            <Button className="mt-4" onClick={onExploreKitchens}>
              {t("tourListExploreCta", "Explore kitchens")}
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="chef-viewings-list">
      <p className="text-sm text-muted-foreground">
        {t(
          "tourListIntroBody",
          "Track confirmation and what you told the kitchen. Expand a row for details."
        )}
      </p>

      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap text-xs sm:text-sm h-9">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <Fragment key={row.id}>
                <TableRow
                  className={cn(
                    "hover:bg-muted/40",
                    chefTourRowHasDetails(row.original) && "cursor-pointer",
                    row.original.status === "pending" && "bg-amber-50/40",
                    row.original.status === "confirmed" && "bg-emerald-50/30"
                  )}
                  onClick={() => {
                    if (chefTourRowHasDetails(row.original)) row.toggleExpanded();
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2 text-xs sm:text-sm">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
                {row.getIsExpanded() && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={columns.length} className="py-3">
                      <TourDetailPanel tour={row.original} t={t as any} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
