import { Package, Snowflake, Thermometer, Boxes } from "lucide-react";
import * as ManagerIcons from "@/components/ui/manager-icons";
import { useTranslation } from "react-i18next";
import { SmartImage } from "@/components/ui/smart-image";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";
import { cn } from "@/lib/utils";

/** The same type thumbnail everywhere, including listings with no uploaded photos. */
export function StoragePhoto({ storageType, photos, className, iconSet = 'chef' }: { storageType?: string; photos?: string[] | null; className?: string; iconSet?: 'chef' | 'manager' }) {
  const { t } = useTranslation("storage");
  const kind = storageType === "freezer" || storageType === "frozen" ? "frozen" : storageType === "cold" ? "cold" : storageType === "dry" ? "dry" : "other";
  const icons = iconSet === 'manager' ? ManagerIcons : { Package, Thermometer, Snowflake, Boxes };
  const Icon = { dry: icons.Package, cold: icons.Thermometer, frozen: icons.Snowflake, other: icons.Boxes }[kind];
  const tint = { dry: "bg-amber-50 text-amber-700", cold: "bg-cyan-50 text-cyan-700", frozen: "bg-indigo-50 text-indigo-700", other: "bg-slate-100 text-slate-600" }[kind];
  return <div className={cn("relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg", tint, className)}>
    <span role="img" aria-label={t(`stPhoto_${kind}` as never)}><Icon className="h-7 w-7" aria-hidden="true" /></span>
    {photos?.[0] && <SmartImage src={getR2ProxyUrl(photos[0])} alt="" hideOnError loading="lazy" className="absolute inset-0 h-full w-full object-cover" />}
  </div>;
}
