import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SmartImage } from "@/components/ui/smart-image";
import { TruncatedText } from "@/components/common/TruncatedText";
import chefCookingImage from "@/assets/chef-cooking.png";
import emptyKitchenImage from "@assets/emptykitchen.png";
import { cn } from "@/lib/utils";

type PathItem = {
  title: string;
  detail: string;
};

function GetStartedPathCard({
  image,
  imageAlt,
  imageCaption,
  imagePositionClass,
  title,
  description,
  steps,
  ctaLabel,
  onCta,
  ctaTestId,
  loading = "lazy",
  compact = false,
}: {
  image: string;
  imageAlt: string;
  imageCaption: string;
  imagePositionClass: string;
  title: string;
  description: string;
  steps: PathItem[];
  ctaLabel: string;
  onCta: () => void;
  ctaTestId?: string;
  loading?: "lazy" | "eager";
  compact?: boolean;
}) {
  const { t } = useTranslation("chef");

  if (compact) {
    return (
      <Card className="flex h-full flex-col shadow-none">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <CardDescription className="mt-1">{description}</CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0 font-medium">
              {t("gsNotStartedBadge")}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 pt-0">
          <ol role="list" className="divide-y border-y list-none p-0">
            {steps.map((item, index) => (
              <li key={item.title} className="flex items-center gap-3 py-2">
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground"
                >
                  {index + 1}
                </span>
                <TruncatedText as="p" className="min-w-0 truncate text-sm font-medium">{item.title}</TruncatedText>
              </li>
            ))}
          </ol>
        </CardContent>
        <CardFooter className="mt-auto flex-row justify-end gap-2">
          <Button size="sm" onClick={onCta} data-testid={ctaTestId}>
            {ctaLabel}
            <ArrowRight />
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden shadow-none">
      <div className="p-3 pb-0">
        <div className="group relative overflow-hidden rounded-md ring-1 ring-inset ring-black/10">
          <SmartImage
            src={image}
            alt={imageAlt}
            loading={loading}
            sizes="(max-width: 1024px) 100vw, 50vw"
            className={cn(
              "h-40 w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] sm:h-48",
              imagePositionClass
            )}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          <p className="absolute bottom-2.5 left-3 right-3 text-sm font-medium leading-snug text-white">
            {imageCaption}
          </p>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col pt-4">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="mt-1">{description}</CardDescription>

        <ol role="list" className="mt-4 list-none space-y-3 p-0">
          {steps.map((item, index) => (
            <li key={item.title} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium text-muted-foreground"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5">{item.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>

      <CardFooter className="mt-auto flex-row justify-end gap-2">
        <Button size="sm" onClick={onCta} data-testid={ctaTestId}>
          {ctaLabel}
          <ArrowRight />
        </Button>
      </CardFooter>
    </Card>
  );
}



export function SellerPathEmptyCard({
  onApply,
  loading = "lazy",
  compact = false,
}: {
  onApply: () => void;
  loading?: "lazy" | "eager";
  compact?: boolean;
}) {
  const { t } = useTranslation("common");
  const SELLER_STEPS: PathItem[] = [
    {
      title: t("sellerStep1Title", "Apply in about 10 minutes"),
      detail: t("sellerStep1Detail", "Personal details, kitchen setting, and certifications."),
    },
    {
      title: t("sellerStep2Title", "We review within 24–48 hours"),
      detail: t("sellerStep2Detail", "Most reviews finish quickly. We email you when status changes."),
    },
    {
      title: t("sellerStep3Title", "List your food after approval"),
      detail: t("sellerStep3Detail", "We handle delivery, payments, and support. Food safety videos are optional."),
    },
  ];

  return (
    <GetStartedPathCard
      image={chefCookingImage}
      imageAlt={t("chefCookingAlt", "A cook preparing food in a home kitchen")}
      imageCaption={t("chefCookingCaption", "Cook what you already make. We handle the rest.")}
      imagePositionClass="object-[center_22%]"
      title={t("sellerApplicationTitle", "Seller application")}
      description={t("sellerApplicationDesc", "List homemade food on LocalCooks after approval.")}
      steps={SELLER_STEPS}
      ctaLabel={t("applyToSell", "Apply to sell")}
      ctaTestId="seller-application-start"
      onCta={onApply}
      loading={loading}
      compact={compact}
    />
  );
}

export function KitchenPathEmptyCard({
  onExplore,
  loading = "lazy",
  compact = false,
}: {
  onExplore: () => void;
  loading?: "lazy" | "eager";
  compact?: boolean;
}) {
  const { t } = useTranslation("common");
  const KITCHEN_STEPS: PathItem[] = [
    {
      title: t("kitchenStep1Title", "Browse partner kitchens"),
      detail: t("kitchenStep1Detail", "Compare hourly rates, equipment, and location, then apply from the listing."),
    },
    {
      title: t("kitchenStep2Title", "Kitchen reviews your application"),
      detail: t("kitchenStep2Detail", "They approve access. Complete extra documents if they ask."),
    },
    {
      title: t("kitchenStep3Title", "Book hourly prep time"),
      detail: t("kitchenStep3Detail", "Sessions open after that kitchen fully approves you."),
    },
  ];

  return (
    <GetStartedPathCard
      image={emptyKitchenImage}
      imageAlt={t("kitchenAccessAlt", "A licensed commercial kitchen ready for booking")}
      imageCaption={t("kitchenAccessCaption", "Licensed commercial kitchens, booked by the hour.")}
      imagePositionClass="object-center"
      title={t("kitchenAccessTitle", "Kitchen access")}
      description={t("kitchenAccessDesc", "Apply to a partner kitchen, get approved, then book time to cook.")}
      steps={KITCHEN_STEPS}
      ctaLabel={t("exploreKitchens", "Explore kitchens")}
      onCta={onExplore}
      loading={loading}
      compact={compact}
    />
  );
}
