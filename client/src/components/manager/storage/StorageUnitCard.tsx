import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar, User } from "@/components/ui/manager-icons";
import { StorageStatusChip } from "@/components/manager/storage/StorageStatusChip";
import { formatBookingDate } from "@/lib/formatters";
import type { UnitDateKey, UnitRow } from "@/lib/storage-board";

const DATE_KEY: Record<UnitDateKey, string> = {
  startsOn: "stDateStartsOn",
  paidThrough: "stDatePaidThrough",
  extendBy: "stDateExtendBy",
  graceEnded: "stDateGraceEnded",
  releasedOn: "stDateReleasedOn",
};

/** One physical unit: its chip, its occupant, the one date that matters, and one primary action. */
export function StorageUnitCard({ row }: { row: UnitRow }) {
  const { t } = useTranslation("storage");
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{t("stUnitLabel", { index: row.unitIndex })}</span>
          <StorageStatusChip chip={row.chip} />
        </div>
        <div className="flex-1 space-y-1 text-sm">
          <p className="flex items-center gap-1.5">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{row.occupantName ?? t("stNoOccupant")}</span>
          </p>
          {row.date && (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t(DATE_KEY[row.date.key], { date: formatBookingDate(row.date.value) })}</span>
            </p>
          )}
        </div>
        {row.rental && (
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link href={`/manager/storage/${row.rental.id}`}>{t("stViewUnit")}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
