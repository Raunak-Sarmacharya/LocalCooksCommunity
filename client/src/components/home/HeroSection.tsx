import { Button } from "@/components/ui/button";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ChefHat, CreditCard, ShoppingBag, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import chefCookingImage from "../../assets/chef-cooking.png";
import foodDeliveryImage from "../../assets/food-delivery.png";
import GradientHero from "@/components/ui/GradientHero";
import FadeInSection from "@/components/ui/FadeInSection";

export default function HeroSection() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  // Typewriter effect state
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  // Dynamic words for typewriter effect
  const getWords = () => {
    return ["Cooks", "Company", "Community"];
  };

  const words = getWords();

  useEffect(() => {
    const word = words[currentWordIndex];
    const shouldDelete = isDeleting;

    const timeout = setTimeout(() => {
      if (!shouldDelete) {
        // Typing
        if (currentText.length < word.length) {
          setCurrentText(word.slice(0, currentText.length + 1));
        } else {
          // Wait before deleting
          setTimeout(() => setIsDeleting(true), 1500);
        }
      } else {
        // Deleting
        if (currentText.length > 0) {
          setCurrentText(currentText.slice(0, -1));
        } else {
          setIsDeleting(false);
          setCurrentWordIndex((prev: number) => (prev + 1) % words.length);
        }
      }
    }, shouldDelete ? 100 : 150); // Faster deleting, slower typing

    return () => clearTimeout(timeout);
  }, [currentText, isDeleting, currentWordIndex, words]);

  const handleChefClick = () => {
    if (!user) {
      navigate(`/auth`);
    } else {
      navigate(getNavigationPath());
    }
  };



  const getPrimaryButtonText = () => {
    return getButtonText("Start Your Application");
  };

  return (
    <GradientHero variant="cream" className="pt-20 sm:pt-24 md:pt-28 lg:pt-36 pb-8 sm:pb-12 md:pb-16 lg:pb-20 px-4 sm:px-6 relative overflow-hidden">
      {/* Enhanced background decorative elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute top-20 left-10 w-48 sm:w-64 md:w-72 h-48 sm:h-64 md:h-72 bg-brand-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-64 sm:w-80 md:w-96 h-64 sm:h-80 md:h-96 bg-gold rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto max-w-6xl relative z-10 px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center space-y-6 sm:space-y-8 md:space-y-10"
        >
          {/* Brand Name with enhanced styling */}
          <motion.div
            className="space-y-2 sm:space-y-3 md:space-y-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <h1 className="font-display text-[2.5rem] sm:text-[3.5rem] md:text-[4.5rem] lg:text-[5rem] xl:text-[6rem] text-brand-primary leading-none mb-2 sm:mb-3 md:mb-4 drop-shadow-sm">
              LocalCooks
            </h1>
            <p className="font-mono text-[9px] sm:text-[10px] md:text-[11px] lg:text-[12px] text-charcoal-light uppercase tracking-[0.3em] sm:tracking-[0.4em] md:tracking-[0.5em] mb-4 sm:mb-6 md:mb-8 font-medium px-2">
              Homemade with Love
            </p>
          </motion.div>

          {/* Main Heading with enhanced typography */}
          <motion.h2
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-bold mb-4 sm:mb-6 md:mb-8 text-brand-text font-sans max-w-5xl mx-auto leading-tight px-2"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            {user ? "Bringing Communities Together Through Homemade Meals" : "Local Cooks • Local Company • Local Community"}
          </motion.h2>

          {/* Description with better spacing */}
          <motion.p
            className="text-base sm:text-lg md:text-xl lg:text-2xl mb-6 sm:mb-8 md:mb-12 text-brand-text/90 leading-relaxed font-sans max-w-3xl mx-auto font-medium px-4"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
          >
            {user ? "Manage your chef applications and transform your culinary passion into a business." : "Join Local Cooks as a chef to share your culinary skills and connect communities with fresh, homemade meals."}
          </motion.p>

          {/* Benefits Grid with enhanced design */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-8 sm:mb-10 md:mb-12 max-w-5xl mx-auto px-2"
          >
            <motion.div
              className="flex flex-col items-center gap-3 text-center group cursor-pointer"
              whileHover={{ scale: 1.05, y: -4 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <div className="p-3 md:p-4 bg-gradient-to-br from-green-100 to-green-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                <ChefHat className="h-6 w-6 md:h-7 md:w-7 text-green-600" />
              </div>
              <span className="text-xs md:text-sm font-semibold text-brand-text">Showcase your talent</span>
            </motion.div>
            <motion.div
              className="flex flex-col items-center gap-3 text-center group cursor-pointer"
              whileHover={{ scale: 1.05, y: -4 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <div className="p-3 md:p-4 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                <Users className="h-6 w-6 md:h-7 md:w-7 text-blue-600" />
              </div>
              <span className="text-xs md:text-sm font-semibold text-brand-text">Expand your network</span>
            </motion.div>
            <motion.div
              className="flex flex-col items-center gap-3 text-center group cursor-pointer"
              whileHover={{ scale: 1.05, y: -4 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <div className="p-3 md:p-4 bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                <ShoppingBag className="h-6 w-6 md:h-7 md:w-7 text-yellow-600" />
              </div>
              <span className="text-xs md:text-sm font-semibold text-brand-text">We handle delivery</span>
            </motion.div>
            <motion.div
              className="flex flex-col items-center gap-3 text-center group cursor-pointer"
              whileHover={{ scale: 1.05, y: -4 }}
              transition={{ type: "spring", stiffness: 300 }}
            >
              <div className="p-3 md:p-4 bg-gradient-to-br from-purple-100 to-purple-200 rounded-2xl shadow-md group-hover:shadow-xl transition-all duration-300">
                <CreditCard className="h-6 w-6 md:h-7 md:w-7 text-purple-600" />
              </div>
              <span className="text-xs md:text-sm font-semibold text-brand-text">Get paid weekly</span>
            </motion.div>
          </motion.div>

          {/* CTA Button with enhanced design */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="flex justify-center"
          >
            {!user ? (
              // Guest users - show only chef option
              <Button
                onClick={handleChefClick}
                size="lg"
                className="w-full sm:w-auto bg-gradient-to-r from-brand-primary to-[#FF5470] hover:from-[#FF5470] hover:to-brand-primary text-white font-bold py-4 sm:py-5 md:py-7 px-8 sm:px-10 md:px-16 text-base sm:text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform min-h-[48px] sm:min-h-[56px]"
              >
                Apply as Chef
              </Button>
            ) : (
              // Logged-in users - show personalized button
              <Button
                onClick={handleChefClick}
                disabled={isLoading}
                size="lg"
                className="w-full sm:w-auto bg-gradient-to-r from-brand-primary to-[#FF5470] hover:from-[#FF5470] hover:to-brand-primary text-white font-bold py-4 sm:py-5 md:py-7 px-8 sm:px-10 md:px-16 text-base sm:text-lg md:text-xl rounded-xl transition-all duration-300 shadow-2xl hover:shadow-[0_0_30px_rgba(245,16,66,0.5)] hover:-translate-y-1 transform disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] sm:min-h-[56px]"
              >
                {isLoading ? "Loading..." : getPrimaryButtonText()}
              </Button>
            )}
          </motion.div>
        </motion.div>
      </div>
    </GradientHero>
  );
}
