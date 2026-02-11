/**
 * @deprecated This page is deprecated. Chef applications are now managed via ManagerKitchenApplications.
 * The old "Share Profile" workflow has been replaced by direct kitchen applications.
 * This page redirects to the new Applications page in the booking dashboard.
 */

import { useEffect } from "react";
import { useLocation, Link } from "wouter";
import ManagerHeader from "@/components/layout/ManagerHeader";
import { Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

interface ManagerChefProfilesProps {
  embedded?: boolean;
}

export default function ManagerChefProfiles({ embedded = false }: ManagerChefProfilesProps) {
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
      <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-[#208D80] to-[#2BA89F] flex items-center justify-center">
        <ArrowRight className="h-10 w-10 text-white" />
      </div>
      
      <h1 className="text-2xl font-bold text-gray-900 mb-3">
        Page Has Moved!
      </h1>
      
      <p className="text-gray-600 mb-6">
        Chef profiles and applications are now managed in a unified "Applications" tab 
        in the booking dashboard. This provides a better experience for reviewing 
        chef applications and their documents.
      </p>
      
      <div className="bg-[#208D80]/5 border border-[#208D80]/20 rounded-xl p-4 mb-6">
        <h3 className="font-semibold text-[#208D80] mb-2">What's New:</h3>
        <ul className="text-sm text-gray-700 text-left space-y-1">
          <li>✅ Unified Applications tab for all chef applications</li>
          <li>✅ View and verify documents directly</li>
          <li>✅ Approve or reject applications with feedback</li>
          <li>✅ See pending, approved, and rejected applications</li>
        </ul>
      </div>
      
      <div className="space-y-3">
        <Link href="/manager/booking-dashboard">
          <Button variant="secondary" className="w-full text-lg py-6">
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
    </div>
  );
}
