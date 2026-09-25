import React from "react";
import localCooksLogo from "@assets/Logo_LocalCooks.png";
import markBrand from "@/assets/local-cooks-mark.svg";
import markWhite from "@/assets/local-cooks-mark-white.svg";
import { cn } from "@/lib/utils";

/*
 * The mark comes from a traced vector, not a filtered bitmap.
 *
 * `logo-white.png` is the only flat raster of the mark and it carries a baked-in grey drop
 * shadow (14.5% of its opaque pixels are non-white). Recolouring it with a CSS filter - which is
 * what the "brand" variant used to do - flattened that shadow into a second, offset silhouette,
 * and a 500px bitmap downscaled to 36px in the header read as a doubled, fuzzy edge. The vector
 * is a faithful trace of the same artwork (0.8% pixel disagreement against the source alpha mask,
 * measured by dev/trace-logo.py), with the shadow dropped and the fill flat.
 *
 * `object-contain` matters: several call sites size the logo with BOTH a width and a height
 * (`h-4 w-4`, `size-5`). The mark is not square - 1.086 : 1 - so without it those boxes would
 * stretch it horizontally. With it, the mark fits inside whatever box it is given, undistorted.
 */

interface LogoProps {
  className?: string;
  variant?: "default" | "white" | "brand";
}

const Logo: React.FC<LogoProps> = ({ className, variant = "default" }) => {
  if (variant === "brand") {
    return (
      <img
        src={markBrand}
        alt="Local Cooks"
        className={cn("object-contain", className)}
      />
    );
  }

  if (variant === "white") {
    return (
      <img
        src={markWhite}
        alt="Local Cooks"
        className={cn("object-contain", className)}
      />
    );
  }

  return (
    <img src={localCooksLogo} alt="Local Cooks" className={cn("object-contain", className)} />
  );
};

export default Logo;
