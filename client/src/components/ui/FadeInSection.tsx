import { ReactNode } from "react";

interface FadeInSectionProps {
  children: ReactNode;
  delay?: 0 | 1 | 2 | 3;
  className?: string;
}

export default function FadeInSection({
  children,
  delay = 0,
  className = "",
}: FadeInSectionProps) {
  const delayClass =
    delay === 0
      ? "fade-in-section"
      : delay === 1
      ? "fade-in-section-delay-1"
      : delay === 2
      ? "fade-in-section-delay-2"
      : "fade-in-section-delay-3";

  return <div className={`${delayClass} ${className}`}>{children}</div>;
}

