import { Button } from "@/components/ui/button";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { useLocation } from "wouter";

export default function CTASection() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  const handleChefClick = () => {
    if (!user) {
      navigate(`/auth`);
    } else {
      navigate(getNavigationPath());
    }
  };

  const handleDeliveryPartnerClick = () => {
    if (!user) {
      navigate(`/driver-auth`);
    } else {
      navigate('/delivery-partner-apply');
    }
  };


  const getPrimaryButtonText = () => {
    return getButtonText("Start an Application");
  };

  const getHeadingText = () => {
    if (user?.role === "admin") {
      return "Manage Local Cooks";
    } else if ((user as any)?.isDeliveryPartner) {
      return "Ready to Start Delivering?";
    } else if ((user as any)?.isChef) {
      return "Ready to Start Cooking?";
    } else {
      return "Join Local Cooks";
    }
  };

  const getDescriptionText = () => {
    if (user?.role === "admin") {
      return "Manage applications, users, and platform settings from your admin dashboard.";
    } else if ((user as any)?.isDeliveryPartner) {
      return "Manage your delivery applications and documentation.";
    } else if ((user as any)?.isChef) {
      return "Manage your chef applications and start cooking.";
    } else {
      return "Start your journey as a chef with Local Cooks.";
    }
  };


  return (
    <section className="py-16 md:py-24 px-4 bg-gradient-to-b from-white via-[var(--color-cream)]/30 to-[var(--color-cream)]/50 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute top-20 left-20 w-96 h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-80 h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
      </div>
      
      <div className="container mx-auto text-center relative z-10 max-w-4xl">
        <motion.h2 
          className="text-3xl md:text-5xl lg:text-6xl font-bold mb-6 md:mb-8 text-[var(--color-text-primary)]"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {getHeadingText()}
        </motion.h2>
        <motion.p 
          className="text-xl md:text-2xl max-w-3xl mx-auto mb-10 md:mb-12 text-[var(--color-text-primary)]/90 font-sans leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          {getDescriptionText()}
        </motion.p>

        {/* Guest Users - Show only chef option */}
        {!user && (
          <motion.div 
            className="space-y-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="flex justify-center">
              {/* Chef Registration */}
              <motion.div 
                className="bg-white p-8 md:p-10 rounded-3xl shadow-2xl border border-gray-100 hover:shadow-[0_25px_50px_rgba(0,0,0,0.15)] transition-all duration-300 max-w-md w-full relative overflow-hidden group"
                whileHover={{ scale: 1.02, y: -4 }}
              >
                {/* Decorative gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <div className="text-center relative z-10">
                  <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-orange-100 to-orange-200 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <svg className="w-10 h-10 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                    </svg>
                  </div>
                  <h3 className="text-2xl md:text-3xl font-bold text-[var(--color-text-primary)] mb-3 group-hover:text-[var(--color-primary)] transition-colors duration-300">Chef</h3>
                  <p className="text-[var(--color-text-primary)] text-base md:text-lg mb-6 font-sans leading-relaxed">Share your culinary skills with the community</p>
                  <Button
                    onClick={handleChefClick}
                    className="w-full bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-4 px-8 rounded-xl transition-all duration-300 shadow-xl hover:shadow-2xl hover:-translate-y-1 transform text-lg"
                  >
                    Apply as Chef
                  </Button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* Logged-in Users - Show personalized button */}
        {user && (
          <motion.div 
            className="flex justify-center gap-4 flex-wrap mb-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Button
              onClick={handleChefClick}
              disabled={isLoading}
              className="bg-gradient-to-r from-[var(--color-primary)] to-[#FF5470] hover:from-[#FF5470] hover:to-[var(--color-primary)] text-white font-bold py-5 px-12 rounded-xl shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-2 transition-all duration-300 transform text-lg md:text-xl disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? "Loading..." : getPrimaryButtonText()}
            </Button>
          </motion.div>
        )}
      </div>
    </section>
  );
}
