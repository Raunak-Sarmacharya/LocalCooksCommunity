import { Fragment } from "react";
import { cn } from "@/lib/utils";

export function BrandName({ className }: { className?: string }) {
  return (
    <span className={cn("font-logo tracking-tight font-normal", className)}>
      LocalCooks
    </span>
  );
}

export function withBrandName(text: string, className?: string) {
  return text.split(/(LocalCooks|Local Cooks)/g).map((part, i) =>
    part === "LocalCooks" || part === "Local Cooks" ? (
      <BrandName key={i} className={className} />
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}
