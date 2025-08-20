import { Button } from "@/components/ui/button";
import { useApplicationStatus } from "@/hooks/use-application-status";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ChefHat, Clock, CreditCard, DollarSign, Route, ShoppingBag, Truck, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import chefCookingImage from "../../assets/chef-cooking.png";
import foodDeliveryImage from "../../assets/food-delivery.png";

export default function HeroSection() {
  const [, navigate] = useLocation();
  const { user } = useFirebaseAuth();
  const { getButtonText, getNavigationPath, isLoading } = useApplicationStatus();

  // Typewriter effect state
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Dynamic words based on user roles
  const getWords = () => {
    const isChef = (user as any)?.isChef;
    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
    
    if (isChef && isDeliveryPartner) {
      return ["Cooks", "Drivers", "Community"];
    } else if (isDeliveryPartner) {
      return ["Drivers", "Delivery", "Community"];
    } else {
      return ["Cooks", "Company", "Community"];
    }
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

  const handlePrimaryClick = () => {
    if (!user) {
      navigate(`/auth?redirect=/dashboard`);
    } else {
      navigate(getNavigationPath());
    }
  };

  const getPrimaryButtonText = () => {
    return getButtonText("Start Your Application");
  };
  
  return (
    <section className="pt-28 pb-8 md:pt-36 md:pb-16 px-4 bg-gradient-to-br from-white via-light-gray to-pink-50">
      <div className="container mx-auto grid md:grid-cols-2 gap-6 md:gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-4 md:space-y-6"
        >
          <h1 className="text-3xl md:text-5xl font-bold mb-1 md:mb-2">
            Join <span className="font-logo text-primary">
              Local <span className="inline-block min-w-[140px] md:min-w-[200px]">{currentText}<span className="animate-pulse">|</span></span>
            </span>
          </h1>
          <h2 className="text-lg md:text-2xl font-semibold mb-3 md:mb-4 text-gray-700">
            {(() => {
              const isChef = (user as any)?.isChef;
              const isDeliveryPartner = (user as any)?.isDeliveryPartner;
              
              if (isChef && isDeliveryPartner) {
                return "Cooking Excellence, Delivery Excellence";
              } else if (isDeliveryPartner) {
                return "Connecting Communities Through Fast Delivery";
              } else {
                return "Bringing Communities Together Through Homemade Meals";
              }
            })()}
          </h2>
          <p className="text-base md:text-lg mb-4 md:mb-6 text-gray-600 leading-relaxed">
            {(() => {
              const isChef = (user as any)?.isChef;
              const isDeliveryPartner = (user as any)?.isDeliveryPartner;
              
              if (isChef && isDeliveryPartner) {
                return "You're part of our complete ecosystem! Cook amazing meals and deliver exceptional service. Manage both your chef and delivery partner businesses from one unified platform.";
              } else if (isDeliveryPartner) {
                return "Join our delivery network and become an essential part of the local food community. Help bring delicious homemade meals from local cooks to hungry customers with flexible scheduling and competitive earnings.";
              } else {
                return "Local Cooks is where your culinary passion meets limitless possibility. Whether you're a professional chef ready to break free from the line or a home cook with treasured family recipes, we provide the platform, resources, and community you need to transform your kitchen into a thriving business.";
              }
            })()}
          </p>
          
          <div className="grid grid-cols-2 gap-3 md:gap-4 mb-6 md:mb-8">
            {(() => {
              const isChef = (user as any)?.isChef;
              const isDeliveryPartner = (user as any)?.isDeliveryPartner;
              
              if (isDeliveryPartner && !isChef) {
                // Delivery partner only
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-blue-100 rounded-full">
                        <Truck className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Flexible delivery work</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-green-100 rounded-full">
                        <Clock className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Choose your hours</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-yellow-100 rounded-full">
                        <Route className="h-4 w-4 md:h-5 md:w-5 text-yellow-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Optimized routes</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-purple-100 rounded-full">
                        <DollarSign className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Competitive earnings</span>
                    </div>
                  </>
                );
              } else if (isChef && isDeliveryPartner) {
                // Both chef and delivery partner
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-green-100 rounded-full">
                        <ChefHat className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Cook & deliver</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-blue-100 rounded-full">
                        <Truck className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Dual income streams</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-yellow-100 rounded-full">
                        <Users className="h-4 w-4 md:h-5 md:w-5 text-yellow-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Expand your network</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-purple-100 rounded-full">
                        <CreditCard className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Weekly payments</span>
                    </div>
                  </>
                );
              } else {
                // Chef only or no role selected
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-green-100 rounded-full">
                        <ChefHat className="h-4 w-4 md:h-5 md:w-5 text-green-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Showcase your talent</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-blue-100 rounded-full">
                        <Users className="h-4 w-4 md:h-5 md:w-5 text-blue-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Expand your network</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-yellow-100 rounded-full">
                        <ShoppingBag className="h-4 w-4 md:h-5 md:w-5 text-yellow-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">We handle delivery</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 md:p-2 bg-purple-100 rounded-full">
                        <CreditCard className="h-4 w-4 md:h-5 md:w-5 text-purple-600" />
                      </div>
                      <span className="text-xs md:text-sm font-medium">Get paid weekly</span>
                    </div>
                  </>
                );
              }
            })()}
          </div>
          
          <Button 
            onClick={handlePrimaryClick}
            disabled={isLoading}
            size="lg"
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-3 md:py-4 px-6 md:px-8 rounded-full shadow-lg hover-transform hover:shadow-xl w-full sm:w-auto"
          >
            {isLoading ? "Loading..." : getPrimaryButtonText()}
          </Button>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative mt-6 md:mt-0"
        >
          <div className="absolute inset-0 bg-primary/5 rounded-2xl -rotate-3 transform hidden md:block"></div>
          <div className="absolute inset-0 bg-primary/5 rounded-2xl rotate-3 transform hidden md:block"></div>
          <div className="relative overflow-hidden rounded-xl shadow-xl">
            {(() => {
              const isDeliveryPartner = (user as any)?.isDeliveryPartner;
              const isChef = (user as any)?.isChef;
              
              // Show delivery image for delivery partners (unless they're also a chef)
              if (isDeliveryPartner && !isChef) {
                return (
                  <img 
                    src={foodDeliveryImage} 
                    alt="Delivery partner bringing food to customer" 
                    className="w-full h-64 md:h-full object-cover rounded-xl shadow-lg"
                  />
                );
              } else {
                // Default to chef image for chefs or dual-role users
                return (
                  <img 
                    src={chefCookingImage} 
                    alt="Professional chef cooking in home kitchen" 
                    className="w-full h-64 md:h-full object-cover rounded-xl shadow-lg"
                  />
                );
              }
            })()}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
