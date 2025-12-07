import { useEffect, useState } from "react";

interface AnimatedBackgroundOrbsProps {
  variant?: "primary" | "gold" | "both";
  intensity?: "subtle" | "normal" | "strong";
  className?: string;
}

export default function AnimatedBackgroundOrbs({
  variant = "both",
  intensity = "normal",
  className = "",
}: AnimatedBackgroundOrbsProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const sizeMap = {
    subtle: { primary: "w-[250px] h-[250px] md:w-[350px] md:h-[350px]", gold: "w-[200px] h-[200px] md:w-[300px] md:h-[300px]" },
    normal: { primary: "w-[350px] h-[350px] md:w-[500px] md:h-[500px]", gold: "w-[300px] h-[300px] md:w-[450px] md:h-[450px]" },
    strong: { primary: "w-[450px] h-[450px] md:w-[600px] md:h-[600px]", gold: "w-[400px] h-[400px] md:w-[550px] md:h-[550px]" },
  };

  const sizes = sizeMap[intensity];

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {(variant === "primary" || variant === "both") && (
        <div
          className={`bg-orb bg-orb-primary ${sizes.primary} absolute top-[10%] left-[5%] animate-orb-float`}
          style={{ animationDelay: "0s" }}
        />
      )}
      {(variant === "gold" || variant === "both") && (
        <div
          className={`bg-orb bg-orb-gold ${sizes.gold} absolute bottom-[10%] right-[5%] animate-orb-float`}
          style={{ animationDelay: "1s" }}
        />
      )}
    </div>
  );
}

