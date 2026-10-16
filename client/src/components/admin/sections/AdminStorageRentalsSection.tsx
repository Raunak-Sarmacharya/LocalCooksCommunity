/**
 * Admin storage rentals (WP-ST11).
 *
 * A read-only list of every storage rental across kitchens, with a detail drawer. The admin storage
 * endpoints (`GET /api/admin/storage-rentals`, the `actions` endpoint) ship with WP-ST9, so until
 * then the section renders the table it can and a clear "Actions coming soon" note — no buttons that
 * do nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertCircle, Eye } from "@/components/ui/manager-icons";
import { auth } from "@/lib/firebase";
import { formatBookingDate, formatCurrency } from "@/lib/formatters";

interface AdminStorageRental {
  id: number;
  ref: string | null;
  kitchenName: string;
  listingName: string;
  unitLabel: string;
  chefName: string;
  state: string;
  startOn: string | null;
  paidThrough: string | null;
  totalCents: number | null;
}

async function adminFetch(url: string) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not authenticated");
  const token = await currentUser.getIdToken();
  const response = await fetch(url, { credentials: "include", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalize(row: Record<string, any>): AdminStorageRental {
  const sum = Array.isArray(row.terms) ? row.terms.reduce((total: number, term: any) => total + Number(term.totalCents ?? 0), 0) : null;
  return {
    id: Number(row.id),
    ref: row.ref ?? row.referenceCode ?? null,
    kitchenName: row.kitchen?.name ?? row.kitchenName ?? "",
    listingName: row.listing?.name ?? row.listingName ?? "",
    unitLabel: row.unitLabel ?? String(row.unitIndex ?? ""),
    chefName: row.chef?.name ?? row.chefName ?? "",
    state: String(row.state ?? row.rentalState ?? ""),
    startOn: row.startOn ?? row.termStart ?? null,
    paidThrough: row.paidThrough ?? null,
    totalCents: typeof row.totalCents === "number" ? row.totalCents : sum,
  };
}

export function AdminStorageRentalsSection() {
  const { t } = useTranslation("storage");
  const [selected, setSelected] = useState<AdminStorageRental | null>(null);
  const query = useQuery<AdminStorageRental[]>({
    queryKey: ["/api/admin/storage-rentals"],
    retry: false,
    queryFn: async () => {
      const payload = await adminFetch("/api/admin/storage-rentals");
      const rows: Array<Record<string, any>> = Array.isArray(payload) ? payload : payload?.rentals ?? [];
      return rows.map(normalize);
    },
  });

  if (query.isLoading) {
    return (
      <div className="space-y-3" role="status" aria-label={t("stLoading")}>
        <Skeleton className="h-11 w-full rounded-xl" />
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-xl" />)}
      </div>
    );
  }

  const comingSoon = (
    <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{t("stAdminReadOnly")}</p>
    </div>
  );

  if (query.error) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{t("stAdminTitle")}</h2>
        {comingSoon}
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{t("stAdminEmpty")}</CardContent>
        </Card>
      </div>
    );
  }

  const rows = query.data ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("stAdminTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("stAdminSubtitle")}</p>
      </div>
      {comingSoon}
      {rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{t("stAdminEmpty")}</CardContent></Card>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stAdminColRef")}</TableHead>
                <TableHead>{t("stAdminColKitchen")}</TableHead>
                <TableHead>{t("stAdminColListing")}</TableHead>
                <TableHead>{t("stAdminColUnit")}</TableHead>
                <TableHead>{t("stAdminColChef")}</TableHead>
                <TableHead>{t("stAdminColState")}</TableHead>
                <TableHead>{t("stAdminColPaidThrough")}</TableHead>
                <TableHead>{t("stAdminColAmount")}</TableHead>
                <TableHead className="text-right">{t("stAdminDrawerTitle")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.ref ?? `#${row.id}`}</TableCell>
                  <TableCell>{row.kitchenName}</TableCell>
                  <TableCell>{row.listingName}</TableCell>
                  <TableCell>{row.unitLabel}</TableCell>
                  <TableCell>{row.chefName}</TableCell>
                  <TableCell><Badge variant="outline">{row.state}</Badge></TableCell>
                  <TableCell>{row.paidThrough ? formatBookingDate(row.paidThrough) : "—"}</TableCell>
                  <TableCell className="tabular-nums">{row.totalCents != null ? formatCurrency(row.totalCents) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>
                      <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("stViewUnit")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Sheet open={selected !== null} onOpenChange={(next) => { if (!next) setSelected(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <div className="space-y-4">
              <SheetHeader>
                <SheetTitle>{t("stAdminDrawerTitle")}</SheetTitle>
                <SheetDescription>{selected.ref ?? `#${selected.id}`}</SheetDescription>
              </SheetHeader>
              <dl className="space-y-2 text-sm">
                {[
                  [t("stAdminColKitchen"), selected.kitchenName],
                  [t("stAdminColListing"), selected.listingName],
                  [t("stAdminColUnit"), selected.unitLabel],
                  [t("stAdminColChef"), selected.chefName],
                  [t("stAdminColState"), selected.state],
                  [t("stAdminColDates"), selected.startOn ? `${formatBookingDate(selected.startOn)} – ${formatBookingDate(selected.paidThrough ?? selected.startOn)}` : "—"],
                  [t("stAdminColAmount"), selected.totalCents != null ? formatCurrency(selected.totalCents) : "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{t("stAdminComingSoon")}</p>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
