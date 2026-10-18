import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { UnitChip } from "@/lib/storage-board";

const CHIP_KEY: Record<UnitChip, string> = {
  outOfService: "stChipOutOfService",
  free: "stChipFree",
  reserved: "stChipReserved",
  moveInOverdue: "stChipMoveInOverdue",
  occupied: "stChipOccupied",
  endingSoon: "stChipEndingSoon",
  grace: "stChipGrace",
  holdover: "stChipHoldover",
  moveOutDue: "stChipMoveOutDue",
  needsCleaning: "stChipNeedsCleaning",
  removalReview: "stChipRemovalReview",
};

/** AA-contrast chip colours on white and on the muted card. */
const CHIP_CLASS: Record<UnitChip, string> = {
  outOfService: "border-slate-400 bg-slate-100 text-slate-900",
  free: "border-border bg-muted text-muted-foreground",
  reserved: "border-sky-300 bg-sky-50 text-sky-900",
  moveInOverdue: "border-orange-300 bg-orange-50 text-orange-900",
  occupied: "border-emerald-300 bg-emerald-50 text-emerald-900",
  endingSoon: "border-amber-300 bg-amber-50 text-amber-900",
  grace: "border-orange-300 bg-orange-50 text-orange-900",
  holdover: "border-red-300 bg-red-50 text-red-900",
  moveOutDue: "border-orange-400 bg-orange-50 text-orange-900",
  needsCleaning: "border-slate-300 bg-slate-100 text-slate-800",
  removalReview: "border-red-400 bg-red-100 text-red-900",
};

export function StorageStatusChip({ chip, className, detail }: { chip: UnitChip; className?: string; detail?: string }) {
  const { t } = useTranslation("storage");
  return (
    <Badge variant="outline" className={cn("font-medium", CHIP_CLASS[chip], className)}>
      {t(CHIP_KEY[chip] as never)}{detail ? ` · ${detail}` : ''}
    </Badge>
  );
}
