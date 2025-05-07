import React from "react";
import localCooksLogo from "@assets/Logo_LocalCooks.png";
import logoWhite from "@assets/logo-white.png";

interface LogoProps {
  className?: string;
  variant?: "default" | "white";
}

const Logo: React.FC<LogoProps> = ({ className, variant = "default" }) => {
  return (
    <img
      src={variant === "white" ? logoWhite : localCooksLogo}
      alt="Local Cooks Logo"
      className={className}
    />
  );
};

export default Logo;
