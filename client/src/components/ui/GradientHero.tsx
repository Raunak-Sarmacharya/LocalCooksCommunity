import { ReactNode } from "react";
import AnimatedBackgroundOrbs from "./AnimatedBackgroundOrbs";

interface GradientHeroProps {
  children: ReactNode;
  variant?: "warm" | "cool" | "cream" | "dark";
  showOrbs?: boolean;
  orbVariant?: "primary" | "gold" | "both";
  orbIntensity?: "subtle" | "normal" | "strong";
  className?: string;
  contentClassName?: string;
}

export default function GradientHero({
  children,
  variant = "warm",
  showOrbs = true,
  orbVariant = "both",
  orbIntensity = "normal",
  className = "",
  contentClassName = "",
}: GradientHeroProps) {
  const gradientClass =
    variant === "warm"
      ? "gradient-hero-warm"
      : variant === "cool"
      ? "gradient-hero-cool"
      : variant === "cream"
      ? "gradient-hero-cream"
      : "bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900";

  return (
    <section className={`relative ${gradientClass} ${className}`}>
      {showOrbs && <AnimatedBackgroundOrbs variant={orbVariant} intensity={orbIntensity} />}
      <div className={`relative z-10 ${contentClassName}`}>{children}</div>
    </section>
  );
}

