/**
 * @deprecated This page is deprecated. Portal user functionality has been removed.
 * Chef applications are now managed via ManagerKitchenApplications in the booking dashboard.
 * This page redirects to the new Applications page.
 */

import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import ManagerHeader from "@/components/layout/ManagerHeader";
import Footer from "@/components/layout/Footer";
import { Loader2, ArrowRight, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface ManagerPortalApplicationsProps {
  embedded?: boolean;
}

export default function ManagerPortalApplications({ embedded = false }: ManagerPortalApplicationsProps) {
  const [, navigate] = useLocation();
  
  // Redirect to the new Applications page after a short delay
  useEffect(() => {
    const timer = setTimeout(() => {
      navigate("/manager/booking-dashboard");
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [navigate]);

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto bg-white rounded-2xl shadow-lg p-8 text-center"
    >
      {/* Icon */}
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
        <XCircle className="h-10 w-10 text-white" />
      </div>
      
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        Feature Removed
      </h1>
      
      <p className="text-gray-600 mb-6">
        The Portal Applications feature has been deprecated. All chef applications 
        are now managed through the unified "Applications" tab in the booking dashboard.
      </p>
      
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
        <h3 className="font-semibold text-amber-800 mb-2">What Changed:</h3>
        <ul className="text-sm text-amber-700 text-left space-y-1">
          <li>✅ Chefs now apply directly to kitchens</li>
          <li>✅ No separate portal user accounts needed</li>
          <li>✅ All applications in one unified view</li>
          <li>✅ Simpler workflow for everyone</li>
        </ul>
      </div>
      
      <div className="space-y-3">
        <Link href="/manager/booking-dashboard">
          <Button className="w-full bg-[#208D80] hover:bg-[#1A7470] text-lg py-6">
            <ArrowRight className="mr-2 h-5 w-5" />
            Go to Dashboard
          </Button>
        </Link>
      </div>
      
      <div className="flex items-center justify-center gap-2 mt-6 text-xs text-gray-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Redirecting automatically in a few seconds...</span>
      </div>
    </motion.div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-gray-50 to-gray-100">
      <ManagerHeader />
      <main className="flex-1 pt-20 sm:pt-24 lg:pt-28 pb-12 flex items-center justify-center">
        <div className="container mx-auto px-4 py-8">
          {content}
        </div>
      </main>
      <Footer />
    </div>
  );
}
