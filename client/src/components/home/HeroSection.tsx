import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ChefHat, ShoppingBag, Users, CreditCard } from "lucide-react";
import { motion } from "framer-motion";

export default function HeroSection() {
  const [, navigate] = useLocation();
  
  return (
    <section className="pt-24 pb-12 md:pt-32 md:pb-16 px-4 bg-gradient-to-br from-white via-light-gray to-pink-50">
      <div className="container mx-auto grid md:grid-cols-2 gap-8 items-center">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <h1 className="text-4xl md:text-5xl font-bold mb-2">
            Join <span className="font-logo text-primary">Local Cooks</span>
          </h1>
          <h2 className="text-xl md:text-2xl font-semibold mb-4 text-gray-700">
            Bringing Communities Together Through Homemade Meals
          </h2>
          <p className="text-lg mb-6 text-gray-600 leading-relaxed">
            Focus on what you do best—cooking—while we handle orders, delivery, 
            marketing, and customer service. Join our growing community of talented chefs!
          </p>
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-green-100 rounded-full">
                <ChefHat className="h-5 w-5 text-green-600" />
              </div>
              <span className="text-sm font-medium">Showcase your talent</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-blue-100 rounded-full">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <span className="text-sm font-medium">Expand your network</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-yellow-100 rounded-full">
                <ShoppingBag className="h-5 w-5 text-yellow-600" />
              </div>
              <span className="text-sm font-medium">We handle delivery</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-purple-100 rounded-full">
                <CreditCard className="h-5 w-5 text-purple-600" />
              </div>
              <span className="text-sm font-medium">Get paid weekly</span>
            </div>
          </div>
          
          <Button 
            onClick={() => navigate("/apply")}
            size="lg"
            className="bg-primary hover:bg-opacity-90 text-white font-bold py-4 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1 hover:shadow-xl"
          >
            Start Your Application
          </Button>
        </motion.div>
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="relative"
        >
          <div className="absolute inset-0 bg-primary/5 rounded-2xl -rotate-3 transform"></div>
          <div className="absolute inset-0 bg-primary/5 rounded-2xl rotate-3 transform"></div>
          <div className="relative overflow-hidden rounded-xl shadow-xl">
            <img 
              src="https://images.unsplash.com/photo-1556911220-bff31c812dba?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
              alt="Professional chef cooking" 
              className="w-full h-full object-cover rounded-xl shadow-lg"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>

          </div>
        </motion.div>
      </div>
    </section>
  );
}
