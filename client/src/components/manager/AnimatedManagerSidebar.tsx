import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Calendar, Clock, BookOpen, DollarSign, Package, 
  Wrench, Users, CreditCard, Settings, ChevronLeft, 
  ChevronRight, MapPin, Plus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Logo from "@/components/ui/logo";

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AnimatedManagerSidebarProps {
  navItems: NavItem[];
  activeView: string;
  onViewChange: (view: string) => void;
  selectedLocation: {
    id: number;
    name: string;
    address?: string;
    logoUrl?: string;
  } | null;
  locations: Array<{ id: number; name: string }>;
  onLocationChange: (location: { id: number; name: string } | null) => void;
  onCreateLocation: () => void;
  isLoadingLocations?: boolean;
  isMobile?: boolean;
  onCollapseChange?: (isCollapsed: boolean) => void;
}

export default function AnimatedManagerSidebar({
  navItems,
  activeView,
  onViewChange,
  selectedLocation,
  locations,
  onLocationChange,
  onCreateLocation,
  isLoadingLocations = false,
  isMobile = false,
  onCollapseChange,
}: AnimatedManagerSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [logoLoadError, setLogoLoadError] = useState(false);
  
  // Reset logo error when location changes
  useEffect(() => {
    setLogoLoadError(false);
  }, [selectedLocation?.logoUrl]);

  // Handle toggle
  const handleToggle = () => {
    setIsCollapsed(prev => !prev);
  };

  // Notify parent of collapse state changes
  useEffect(() => {
    if (onCollapseChange && !isMobile) {
      onCollapseChange(isCollapsed);
    }
  }, [isCollapsed, onCollapseChange, isMobile]);

  // Auto-collapse on mobile (but not in Sheet)
  useEffect(() => {
    if (isMobile) return;
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsCollapsed(true);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  // Calculate sidebar width
  const sidebarWidth = isMobile ? 256 : (isCollapsed ? 64 : 256);
  
  // Determine if content should be visible
  const isContentVisible = isMobile || !isCollapsed;

  return (
    <TooltipProvider delayDuration={200}>
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        className="relative flex flex-col h-full bg-white border-r border-gray-200"
        style={{ 
          overflow: 'hidden',
        }}
      >
        {/* Collapse Toggle Button */}
        {!isMobile && (
          <button
            onClick={handleToggle}
            className="absolute top-4 right-0 z-50 flex items-center justify-center w-6 h-6 -mr-3 rounded-full bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
            ) : (
              <ChevronLeft className="w-3.5 h-3.5 text-gray-600" />
            )}
          </button>
        )}

        <div className="flex flex-col h-full overflow-hidden">
          {/* Logo Section */}
          <div className="flex-shrink-0 px-4 py-5 border-b border-gray-200">
            <AnimatePresence mode="wait">
              {isContentVisible ? (
                <motion.div
                  key="expanded-logo"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-3"
                >
                  <Logo className="h-8 w-auto flex-shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-gray-900 leading-tight">
                      Local Cooks
                    </span>
                    <span className="text-xs text-gray-500 leading-tight">
                      for Kitchens
                    </span>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="collapsed-logo"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center justify-center"
                >
                  <Logo className="h-8 w-auto" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Location Selection */}
          <div className="flex-shrink-0 px-4 py-4 border-b border-gray-200">
            <AnimatePresence mode="wait">
              {isContentVisible ? (
                <motion.div
                  key="expanded-location"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2"
                >
                  <label className="block text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                    Location
                  </label>
                  {isLoadingLocations ? (
                    <div className="text-xs text-gray-400 py-2">Loading...</div>
                  ) : locations.length === 0 ? (
                    <button
                      onClick={onCreateLocation}
                      className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      No locations
                    </button>
                  ) : locations.length === 1 ? (
                    <div className="space-y-2">
                      <div className="px-3 py-2 text-sm font-medium text-gray-900 rounded-md bg-gray-50">
                        {locations[0].name}
                      </div>
                      <button
                        onClick={onCreateLocation}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F51042] hover:bg-[#F51042]/5 rounded-md transition-colors border border-[#F51042]/20 hover:border-[#F51042]/40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Location
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={selectedLocation?.id || ""}
                        onChange={(e) => {
                          const loc = locations.find((l) => l.id === parseInt(e.target.value));
                          onLocationChange(loc || null);
                        }}
                        className="w-full rounded-md px-3 py-2 text-sm bg-white border border-gray-300 text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#F51042]/20 focus:border-[#F51042] transition-colors"
                      >
                        <option value="">Choose location...</option>
                        {locations.map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={onCreateLocation}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F51042] hover:bg-[#F51042]/5 rounded-md transition-colors border border-[#F51042]/20 hover:border-[#F51042]/40"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Location
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : !isMobile && isCollapsed ? (
                <motion.div
                  key="collapsed-location"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center justify-center"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center justify-center w-10 h-10 rounded-md cursor-default hover:bg-gray-50 transition-colors">
                        <MapPin className="w-5 h-5 text-gray-600" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="center"
                      sideOffset={8}
                      className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg"
                    >
                      {selectedLocation ? selectedLocation.name : "Location"}
                    </TooltipContent>
                  </Tooltip>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          {/* Navigation Items - No scrolling, fits all items */}
          <nav className="flex-1 px-2 py-3 space-y-1 overflow-hidden">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;

              const buttonContent = (
                <button
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className={cn(
                    "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    isCollapsed && !isMobile ? "justify-center" : "justify-start",
                    isActive
                      ? "bg-[#F51042] text-white"
                      : "text-gray-700 hover:bg-gray-50 hover:text-gray-900"
                  )}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <motion.div
                      layoutId="activeIndicator"
                      className="absolute left-0 top-0 bottom-0 w-1 bg-white rounded-r-full"
                      initial={false}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  )}

                  {/* Icon */}
                  <Icon className={cn(
                    "w-5 h-5 flex-shrink-0",
                    isActive ? "text-white" : "text-gray-600"
                  )} />

                  {/* Label - only show when expanded */}
                  <AnimatePresence>
                    {isContentVisible && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex-1 text-left"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              );

              // Wrap with tooltip when collapsed (desktop only)
              if (!isMobile && isCollapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>
                      {buttonContent}
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="center"
                      sideOffset={8}
                      className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg"
                    >
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return buttonContent;
            })}
          </nav>

          {/* Footer/Selected Location Info */}
          {selectedLocation && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <AnimatePresence mode="wait">
                {isContentVisible ? (
                  <motion.div
                    key="expanded-footer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center gap-3"
                  >
                    {/* Location Logo Avatar */}
                    <div className="flex-shrink-0">
                      {selectedLocation.logoUrl && selectedLocation.logoUrl.trim() !== '' && !logoLoadError ? (
                        <img
                          src={selectedLocation.logoUrl}
                          alt={selectedLocation.name}
                          className="w-10 h-10 rounded-md object-cover border border-gray-200"
                          onError={() => {
                            setLogoLoadError(true);
                          }}
                        />
                      ) : (
                        <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#F51042]/10">
                          <MapPin className="w-5 h-5 text-[#F51042]" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">
                        {selectedLocation.name}
                      </p>
                      {selectedLocation.address && (
                        <p className="text-xs text-gray-500 truncate">
                          {selectedLocation.address}
                        </p>
                      )}
                    </div>
                  </motion.div>
                ) : !isMobile && isCollapsed ? (
                  <motion.div
                    key="collapsed-footer"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-center justify-center"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center cursor-default">
                          {selectedLocation.logoUrl && selectedLocation.logoUrl.trim() !== '' && !logoLoadError ? (
                            <img
                              src={selectedLocation.logoUrl}
                              alt={selectedLocation.name}
                              className="w-10 h-10 rounded-md object-cover border border-gray-200 cursor-default"
                              onError={() => {
                                setLogoLoadError(true);
                              }}
                            />
                          ) : (
                            <div className="flex items-center justify-center w-10 h-10 rounded-md bg-[#F51042]/10 cursor-default hover:bg-[#F51042]/15 transition-colors">
                              <MapPin className="w-5 h-5 text-[#F51042]" />
                            </div>
                          )}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent
                        side="right"
                        align="center"
                        sideOffset={8}
                        className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg max-w-[200px]"
                      >
                        <p className="font-semibold">{selectedLocation.name}</p>
                        {selectedLocation.address && (
                          <p className="text-xs text-gray-300 mt-1">{selectedLocation.address}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.aside>
    </TooltipProvider>
  );
}
