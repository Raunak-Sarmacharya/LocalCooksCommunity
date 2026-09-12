import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SmartImage } from "@/components/ui/smart-image";
import { TruncatedText } from "@/components/common/TruncatedText";
import { KitchenPhotoPlaceholder } from "@/components/kitchen/KitchenPhotoPlaceholder";
import { formatEquipmentBreakdown, formatStorageLine, type KitchenGridEquipmentSummary, type KitchenGridStorageSummary } from "@/lib/kitchen-grid-card";
import { CARD_RADIUS } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

export type { KitchenGridStorageSummary, KitchenGridEquipmentSummary };

/** Match Card / CARD_RADIUS so the photo clips to the same corner radius. */
const PHOTO_RADIUS = CARD_RADIUS;

type KitchenGridCardProps = {
  title: string;
  address: string;
  imageUrl?: string | null;
  /** Hourly rate in cents. */
  hourlyRateCents?: number | null;
  /** Daily rate in cents. */
  dailyRateCents?: number | null;
  /** @deprecated Prefer equipmentSummary for included/rental counts. */
  equipment?: string[];
  equipmentSummary?: KitchenGridEquipmentSummary | null;
  storageSummary?: KitchenGridStorageSummary | null;
  /** Optional chip overlaid on the photo (status / open / coming soon). */
  overlayChip?: ReactNode;
  onCardClick?: () => void;
  /**
   * Primary / secondary CTAs. Always rendered in a fixed footer so card height
   * stays stable across states. Pass `actionRows` to reserve empty slots.
   */
  actions?: ReactNode;
  /** Reserved button rows in the footer (default 1). Keeps grid cards equal height. */
  actionRows?: 1 | 2;
  className?: string;
};

function rateBadge(hourlyCents: number | null | undefined, dailyCents: number | null | undefined): string | null {
  const rates = [];
  if (Number(hourlyCents) > 0) rates.push(`$${Math.round(Number(hourlyCents) / 100)}/hr`);
  if (Number(dailyCents) > 0) rates.push(`$${Math.round(Number(dailyCents) / 100)} per day`);
  return rates.length ? rates.join(" · ") : null;
}

/** h-11 row + gap-2 between rows */
function actionsMinHeight(rows: 1 | 2): string {
  return rows === 2 ? "min-h-[6.25rem]" : "min-h-[2.75rem]";
}

export function KitchenGridCard({
  title,
  address,
  imageUrl,
  hourlyRateCents,
  dailyRateCents,
  equipmentSummary,
  storageSummary,
  overlayChip,
  onCardClick,
  actions,
  actionRows = 1,
  className,
}: KitchenGridCardProps) {
  const { t } = useTranslation("kitchen");
  const hasImage = !!imageUrl?.trim();
  const price = rateBadge(hourlyRateCents, dailyRateCents);

  const storageLine = formatStorageLine(
    storageSummary,
    t("gridCardNone", "—"),
    t("gridCardStorageSpaces", "storage spaces")
  );
  const equipmentLine = formatEquipmentBreakdown(equipmentSummary, {
    included: t("gridCardEquipmentIncluded", "included"),
    rental: t("gridCardEquipmentRental", "rental"),
    none: t("gridCardNone", "—"),
  });
  const equipmentTitle =
    equipmentSummary && (equipmentSummary.included > 0 || equipmentSummary.rental > 0)
      ? equipmentLine
      : undefined;

  return (
    <article
      className={cn(
        "group flex h-full flex-col overflow-hidden bg-white shadow-[0_8px_30px_rgba(44,44,44,0.07)] ring-1 ring-[#2C2C2C]/[0.05] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_16px_40px_rgba(245,16,66,0.12)]",
        CARD_RADIUS,
        onCardClick && "cursor-pointer",
        className
      )}
      onClick={onCardClick}
    >
      {/* Inset photo with full card-matching radius + visible stroke */}
      <div className="shrink-0 p-3 pb-0">
        <div
          className={cn(
            "relative aspect-[5/4] w-full overflow-hidden bg-[#F3F1EF]",
            PHOTO_RADIUS,
            "border border-[#E5E0DB] ring-1 ring-[#2C2C2C]/[0.06]"
          )}
        >
          {hasImage ? (
            <SmartImage
              src={getR2ProxyUrl(imageUrl!) || imageUrl!}
              alt={title}
              className={cn(
                "h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]",
                PHOTO_RADIUS
              )}
            />
          ) : (
            <KitchenPhotoPlaceholder className={PHOTO_RADIUS} />
          )}

          {/* Status always top-left — price lives beside the title for scanability */}
          <div className="absolute left-3 top-3 z-10 min-h-7">{overlayChip}</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-4">
        <div className="flex min-h-7 items-start gap-3">
          <TruncatedText
            as="h3"
            className="min-w-0 flex-1 line-clamp-1 text-[1.05rem] font-bold leading-snug text-[#1A1A1A]"
          >
            {title || "\u00a0"}
          </TruncatedText>
          <span
            className={cn(
              "shrink-0 tabular-nums text-sm font-bold leading-snug text-[#F51042]",
              !price && "invisible"
            )}
            aria-hidden={!price}
          >
            {price || "$0/hr"}
          </span>
        </div>
        <TruncatedText
          as="p"
          className="mt-1 line-clamp-1 min-h-5 truncate text-sm leading-relaxed text-[#8A8A8A]"
        >
          {address?.trim() || "\u00a0"}
        </TruncatedText>

        <div className="mt-4 grid shrink-0 grid-cols-2 gap-3 rounded-xl bg-[#F8EFE8] px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A8A80]">
              {t("gridCardStorageLabel", "Storage")}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-[#2C2C2C]">
              {storageLine}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A8A80]">
              {t("gridCardEquipmentLabel", "Equipment")}
            </p>
            <p
              className="mt-1 line-clamp-2 text-sm font-medium leading-snug text-[#2C2C2C]"
              title={equipmentTitle}
            >
              {equipmentLine}
            </p>
          </div>
        </div>

        <div
          className={cn(
            "mt-auto flex shrink-0 flex-col justify-end gap-2 pt-3",
            actionsMinHeight(actionRows)
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      </div>
    </article>
  );
}
