import { BadgeCheck, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface VerificationBadgeProps {
  isVerified: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "outline";
  showText?: boolean;
  className?: string;
}

export default function VerificationBadge({ 
  isVerified, 
  size = "md", 
  variant = "default",
  showText = true,
  className 
}: VerificationBadgeProps) {
  if (!isVerified) {
    return null;
  }

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5",
    md: "text-sm px-2 py-1",
    lg: "text-base px-3 py-1.5"
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4", 
    lg: "h-5 w-5"
  };

  const badgeContent = (
    <Badge 
      variant={variant}
      className={cn(
        "bg-green-100 text-green-800 border-green-200 hover:bg-green-200",
        "flex items-center gap-1.5 font-medium",
        sizeClasses[size],
        className
      )}
    >
      <BadgeCheck className={iconSizes[size]} />
      {showText && "Verified"}
    </Badge>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {badgeContent}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-green-600" />
          <span>This user has been verified with proper food safety documentation</span>
        </div>
      </TooltipContent>
    </Tooltip>
  );
} 