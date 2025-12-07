import React from "react";
import localCooksLogo from "@assets/Logo_LocalCooks.png";
import logoWhite from "@assets/logo-white.png";

interface LogoProps {
  className?: string;
  variant?: "default" | "white" | "brand";
}

const Logo: React.FC<LogoProps> = ({ className, variant = "default" }) => {
  // CSS filter to convert white (#FFFFFF) to brand color (#F51042)
  // This filter formula converts white to the brand red color
  const brandColorFilter = "brightness(0) saturate(100%) invert(27%) sepia(96%) saturate(7500%) hue-rotate(330deg) brightness(96%) contrast(96%)";
  
  if (variant === "brand") {
    return (
      <img
        src={logoWhite}
        alt="Local Cooks Logo"
        className={className}
        style={{ filter: brandColorFilter }}
      />
    );
  }
  
  return (
    <img
      src={variant === "white" ? logoWhite : localCooksLogo}
      alt="Local Cooks Logo"
      className={className}
    />
  );
};

export default Logo;
