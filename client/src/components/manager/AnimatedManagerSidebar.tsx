import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Calendar, Clock, BookOpen, DollarSign, Package, 
  Wrench, Users, CreditCard, Settings, ChevronLeft, 
  ChevronRight, MapPin, Building2
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [isHovered, setIsHovered] = useState(false);

  // Notify parent of collapse state changes
  useEffect(() => {
    if (onCollapseChange && !isMobile) {
      onCollapseChange(isCollapsed && !isHovered);
    }
  }, [isCollapsed, isHovered, onCollapseChange, isMobile]);

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

  const sidebarWidth = isMobile ? 280 : (isCollapsed && !isHovered ? 80 : 280);

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarWidth }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="relative flex flex-col shadow-lg"
      style={{ 
        backgroundColor: '#FFE8DD',
        borderRight: '1px solid rgba(255, 212, 196, 0.5)',
        height: '100%',
        maxHeight: '100%',
      }}
      onMouseEnter={() => !isMobile && setIsHovered(true)}
      onMouseLeave={() => !isMobile && setIsHovered(false)}
    >
      {/* Collapse Toggle Button - Hidden on mobile */}
      {!isMobile && (
        <div className="absolute -right-3 top-6 z-10">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center justify-center w-6 h-6 rounded-full shadow-md hover:shadow-lg transition-shadow"
            style={{ 
              backgroundColor: '#FFE8DD',
              border: '1px solid rgba(255, 212, 196, 0.8)'
            }}
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
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                </motion.div>
              ) : (
                <motion.div
                  key="collapse"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronLeft className="w-3 h-3 text-gray-600" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      )}

      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        {/* Logo/Header Section */}
        <motion.div
          className="px-4 py-6 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255, 212, 196, 0.5)' }}
          animate={{ opacity: (isMobile || !isCollapsed || isHovered) ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <AnimatePresence>
            {(isMobile || !isCollapsed || isHovered) && (
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3"
              >
                <div className="flex items-center justify-center w-10 h-10 rounded-xl shadow-lg" style={{ background: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' }}>
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-bold text-gray-900">Manager</span>
                  <span className="text-xs text-gray-500">Dashboard</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Location Selection */}
        <div className="px-3 py-4 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255, 212, 196, 0.5)' }}>
          <AnimatePresence>
            {(isMobile || !isCollapsed || isHovered) && (
              <motion.div
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
            )}
          </AnimatePresence>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-6 space-y-1" style={{ minHeight: 0, WebkitOverflowScrolling: 'touch', paddingBottom: '1.5rem' }}>
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <motion.button
                key={item.id}
                initial={false}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  "relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group",
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

                {/* Label */}
                <AnimatePresence>
                  {(isMobile || !isCollapsed || isHovered) && (
                    <motion.span
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.2 }}
                      className="flex-1 text-left"
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>

                {/* Hover effect - removed since we're using onMouseEnter/Leave for cream background */}
              </motion.button>
            );
          })}
        </nav>

        {/* Footer/Selected Location Info */}
        {selectedLocation && (isMobile || !isCollapsed || isHovered) && (
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
              {(isMobile || !isCollapsed || isHovered) && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="flex items-center gap-2"
                >
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ backgroundColor: 'rgba(245, 16, 66, 0.1)' }}>
                    <MapPin className="w-4 h-4" style={{ color: '#F51042' }} />
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
      </div>
    </motion.aside>
  );
}
