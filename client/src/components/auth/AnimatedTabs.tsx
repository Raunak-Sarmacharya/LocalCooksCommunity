import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ReactNode } from "react";

interface TabOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface AnimatedTabsProps {
  tabs: TabOption[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  className?: string;
}

const tabVariants = {
  inactive: {
    color: "rgb(107, 114, 128)", // gray-500
    transition: { duration: 0.3 }
  },
  active: {
    color: "rgb(59, 130, 246)", // blue-500
    transition: { duration: 0.3 }
  }
};

const indicatorVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: { opacity: 1, scale: 1 }
};

export default function AnimatedTabs({ tabs, activeTab, onTabChange, className }: AnimatedTabsProps) {
  const activeIndex = tabs.findIndex(tab => tab.value === activeTab);

  return (
    <div className={cn("relative", className)}>
      {/* Tab Container */}
      <div className="relative bg-gray-100 rounded-lg p-1 grid grid-cols-2 gap-1">
        {/* Animated Background Indicator */}
        <motion.div
          className="absolute inset-y-1 bg-white rounded-md shadow-sm"
          initial={false}
          animate={{
            x: activeIndex * 100 + "%",
            transition: {
              type: "spring",
              stiffness: 300,
              damping: 30,
              duration: 0.3
            }
          }}
          style={{
            width: `calc(50% - 2px)`,
            left: "2px"
          }}
        />

        {/* Tab Buttons */}
        {tabs.map((tab, index) => (
          <motion.button
            key={tab.value}
            type="button"
            className={cn(
              "relative z-10 flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold rounded-md transition-all duration-300",
              "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2",
              activeTab === tab.value 
                ? "text-blue-600" 
                : "text-gray-500 hover:text-gray-700"
            )}
            onClick={() => onTabChange(tab.value)}
            variants={tabVariants}
            animate={activeTab === tab.value ? "active" : "inactive"}
            whileHover={activeTab !== tab.value ? { scale: 1.02 } : {}}
            whileTap={{ scale: 0.98 }}
          >
            {tab.icon && (
              <motion.span
                animate={activeTab === tab.value ? { scale: 1.1 } : { scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                {tab.icon}
              </motion.span>
            )}
            <span>{tab.label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

// Tab Content Container with animations
interface AnimatedTabContentProps {
  activeTab: string;
  children: ReactNode;
  className?: string;
}

const contentVariants = {
  enter: {
    opacity: 0,
    x: 20,
    scale: 0.95
  },
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: "easeOut"
    }
  },
  exit: {
    opacity: 0,
    x: -20,
    scale: 0.95,
    transition: {
      duration: 0.3,
      ease: "easeIn"
    }
  }
};

export function AnimatedTabContent({ activeTab, children, className }: AnimatedTabContentProps) {
  return (
    <div className={cn("relative overflow-hidden", className)}>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          variants={contentVariants}
          initial="enter"
          animate="center"
          exit="exit"
          className="w-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
} 