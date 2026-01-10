import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Calendar, Clock, BookOpen, DollarSign, Package, 
  Wrench, Users, CreditCard, Settings, ChevronLeft, 
  ChevronRight, MapPin
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

  // Handle toggle - directly change persistent state
  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    setIsCollapsed(prev => !prev);
    // Immediately remove focus and any visual indicators
    const button = e.currentTarget;
    button.blur();
    // Force remove any focus styles
    button.style.outline = 'none';
    button.style.boxShadow = 'none';
    // Remove focus from any parent elements
    if (document.activeElement === button) {
      (document.activeElement as HTMLElement).blur();
    }
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

  // Calculate sidebar width: 
  // - Mobile: always full width (280px)
  // - Desktop collapsed: narrow (80px)
  // - Desktop expanded: full width (280px)
  const sidebarWidth = isMobile ? 280 : (isCollapsed ? 80 : 280);
  
  // Determine if content should be visible (for labels, location selector, etc.)
  // Visible when: mobile or expanded (NOT when collapsed - tooltips will show instead)
  const isContentVisible = isMobile || !isCollapsed;

  return (
    <TooltipProvider delayDuration={300}>
      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        className="relative flex flex-col shadow-lg h-full"
        style={{ 
          backgroundColor: '#FFE8DD',
          borderRight: '1px solid rgba(255, 212, 196, 0.5)',
          overflow: 'visible', // Allow button to extend outside sidebar
        }}
      >
      {/* Collapse Toggle Button - Always visible on desktop, positioned for easy access */}
      {!isMobile && (
        <div 
          className="absolute top-6 z-50"
          style={{ 
            right: '-14px', // Position half outside sidebar (button is 28px wide, so -14px centers it on edge)
            pointerEvents: 'auto',
          }}
        >
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleToggle}
            className="flex items-center justify-center w-7 h-7 rounded-full shadow-lg hover:shadow-xl transition-all"
            style={{ 
              backgroundColor: '#FFFFFF',
              border: '2px solid rgba(255, 212, 196, 0.8)',
              outline: 'none',
              boxShadow: '0 2px 8px 0 rgba(0, 0, 0, 0.15), 0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            }}
            onFocus={(e) => {
              // Immediately remove focus visual indicators
              e.currentTarget.style.outline = 'none';
              e.currentTarget.style.boxShadow = '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)';
              // Blur after a tiny delay to allow click to complete
              setTimeout(() => {
                e.currentTarget.blur();
              }, 0);
            }}
            onMouseDown={(e) => {
              // Prevent focus on mousedown for mouse users
              if (e.detail > 0) {
                e.preventDefault();
              }
            }}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
          >
            <AnimatePresence mode="wait">
              {isCollapsed ? (
                <motion.div
                  key="expand"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight className="w-4 h-4 text-gray-700" />
                </motion.div>
              ) : (
                <motion.div
                  key="collapse"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronLeft className="w-4 h-4 text-gray-700" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      )}

      <div className="flex flex-col h-full min-h-0" style={{ overflow: 'hidden' }}>
        {/* Location Selection */}
        <div className="px-3 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255, 212, 196, 0.5)' }}>
          <AnimatePresence mode="wait">
            {isContentVisible ? (
              <motion.div
                key="expanded"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Location
                </label>
                {isLoadingLocations ? (
                  <div className="text-xs text-gray-400">Loading...</div>
                ) : locations.length === 0 ? (
                  <button
                    onClick={onCreateLocation}
                    className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:text-gray-700 rounded-lg transition-colors"
                    style={{ 
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#FFD4C4'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    No locations
                  </button>
                ) : locations.length === 1 ? (
                  <div className="px-3 py-2 text-sm font-medium text-gray-900 rounded-lg" style={{ backgroundColor: '#FFD4C4', border: '1px solid rgba(255, 212, 196, 0.8)' }}>
                    {locations[0].name}
                  </div>
                ) : (
                  <select
                    value={selectedLocation?.id || ""}
                    onChange={(e) => {
                      const loc = locations.find((l) => l.id === parseInt(e.target.value));
                      onLocationChange(loc || null);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#F51042] focus:border-[#F51042]"
                    style={{ 
                      backgroundColor: '#FFFFFF',
                      border: '1px solid rgba(255, 212, 196, 0.8)'
                    }}
                  >
                    <option value="">Choose location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name}
                      </option>
                    ))}
                  </select>
                )}
              </motion.div>
            ) : !isMobile && isCollapsed ? (
              // Collapsed state - show icon only with tooltip
              <motion.div
                key="collapsed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center justify-center"
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg cursor-default hover:bg-[#FFD4C4] transition-colors" style={{ backgroundColor: 'rgba(255, 212, 196, 0.3)' }}>
                      <MapPin className="w-5 h-5 text-gray-700" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    align="center"
                    sideOffset={8}
                    className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg border-0"
                  >
                    {selectedLocation ? selectedLocation.name : "Location"}
                  </TooltipContent>
                </Tooltip>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {/* Navigation Items - Only this section scrolls */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-6 space-y-1" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch', paddingBottom: '1.5rem', scrollbarWidth: 'thin', scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent' }}>
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            const buttonContent = (
              <motion.button
                key={item.id}
                initial={false}
                whileHover={{ x: isCollapsed ? 0 : 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
                  isCollapsed && !isMobile ? "justify-center" : "justify-start",
                  isActive
                    ? "text-white shadow-lg"
                    : "text-gray-700 hover:text-[#F51042]"
                )}
                style={{
                  ...(isActive ? {
                    background: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                    boxShadow: '0 10px 15px -3px rgba(245, 16, 66, 0.3)',
                  } : {
                    backgroundColor: 'transparent',
                  }),
                  animationDelay: `${index * 0.05}s`,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = '#FFD4C4';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
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
                <motion.div
                  animate={{
                    scale: isActive ? 1.1 : 1,
                  }}
                  transition={{ duration: 0.2 }}
                >
                  <Icon className={cn("w-5 h-5 flex-shrink-0", isActive && "text-white")} />
                </motion.div>

                {/* Label - only show when expanded */}
                <AnimatePresence>
                  {isContentVisible && (
                    <motion.span
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.2 }}
                      className="flex-1 text-left hidden lg:block"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
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
                    className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg border-0"
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
        {selectedLocation && isContentVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-3 py-3 flex-shrink-0"
            style={{ 
              borderTop: '1px solid rgba(255, 212, 196, 0.5)',
              backgroundColor: '#FFD4C4',
              marginTop: 'auto', // Push to bottom
            }}
          >
            <AnimatePresence>
              {isContentVisible && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex items-center gap-3"
                >
                  {/* Location Logo Avatar - Professional avatar display */}
                  <div className="flex-shrink-0">
                    {selectedLocation.logoUrl && selectedLocation.logoUrl.trim() !== '' && !logoLoadError ? (
                      <img
                        src={selectedLocation.logoUrl}
                        alt={selectedLocation.name}
                        className="w-10 h-10 rounded-lg object-cover border-2 border-white shadow-sm"
                        onError={() => {
                          setLogoLoadError(true);
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center w-10 h-10 rounded-lg" style={{ backgroundColor: 'rgba(245, 16, 66, 0.1)' }}>
                        <MapPin className="w-5 h-5" style={{ color: '#F51042' }} />
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
              )}
            </AnimatePresence>
          </motion.div>
        )}
        
        {/* Footer/Selected Location Info - Collapsed State with Tooltip */}
        {selectedLocation && !isContentVisible && !isMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-3 py-3 flex-shrink-0"
            style={{ 
              borderTop: '1px solid rgba(255, 212, 196, 0.5)',
              backgroundColor: '#FFD4C4',
              marginTop: 'auto', // Push to bottom
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-center cursor-default">
                  {selectedLocation.logoUrl && selectedLocation.logoUrl.trim() !== '' && !logoLoadError ? (
                    <img
                      src={selectedLocation.logoUrl}
                      alt={selectedLocation.name}
                      className="w-10 h-10 rounded-lg object-cover border-2 border-white shadow-sm cursor-default"
                      onError={() => {
                        setLogoLoadError(true);
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg cursor-default hover:bg-[#FFD4C4] transition-colors" style={{ backgroundColor: 'rgba(245, 16, 66, 0.1)' }}>
                      <MapPin className="w-5 h-5" style={{ color: '#F51042' }} />
                    </div>
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                align="center"
                sideOffset={8}
                className="bg-gray-900 text-white text-sm font-medium px-3 py-2 shadow-lg border-0 max-w-[200px]"
              >
                <p className="font-semibold">{selectedLocation.name}</p>
                {selectedLocation.address && (
                  <p className="text-xs text-gray-300 mt-1">{selectedLocation.address}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </motion.div>
        )}
      </div>
    </motion.aside>
    </TooltipProvider>
  );
}
