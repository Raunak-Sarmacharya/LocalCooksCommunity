import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Check, Camera, Medal, TrendingUp, Megaphone, Wallet, Calendar, CreditCard, Settings } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";

const pilotBenefits = [
  {
    icon: <Medal className="text-amber-400" />,
    text: "Reduced platform fees during trial phase",
    description: "Save on commission fees while we grow together"
  },
  {
    icon: <TrendingUp className="text-blue-400" />,
    text: "Priority placement in our app",
    description: "Get more visibility with featured chef status"
  },
  {
    icon: <Camera className="text-green-400" />,
    text: "Free professional photography for your dishes",
    description: "High-quality images to showcase your food"
  },
  {
    icon: <Megaphone className="text-purple-400" />,
    text: "Personalized marketing support",
    description: "Custom promotions to attract more customers"
  }
];

const mainBenefits = [
  {
    title: "Financial Freedom",
    icon: <Wallet className="h-10 w-10 text-amber-500" />,
    description: "Set your own prices and build a steady income stream without the overhead of a traditional restaurant"
  },
  {
    title: "Flexible Schedule",
    icon: <Calendar className="h-10 w-10 text-blue-500" />,
    description: "Work when you want – whether that's full-time, weekends only, or just a few days a month"
  },
  {
    title: "Weekly Payments",
    icon: <CreditCard className="h-10 w-10 text-green-500" />,
    description: "Get paid directly to your bank account every week – no long waiting periods"
  },
  {
    title: "Simple Tools",
    icon: <Settings className="h-10 w-10 text-purple-500" />,
    description: "Easy-to-use platform to manage orders, update your menu, and track your earnings"
  }
];

export default function BenefitsSection() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  
  const handleApplicationClick = () => {
    // If not logged in, redirect to auth page, otherwise to application form
    navigate(user ? "/apply" : "/auth");
  };
  
  return (
    <section id="benefits" className="py-16 md:py-24 px-4 bg-gradient-to-b from-blue-50 to-white scroll-mt-24">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <motion.span 
            className="inline-block text-primary font-medium mb-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Why Join Us
          </motion.span>
          <motion.h2 
            className="text-3xl md:text-4xl font-bold mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Benefits for Cooks
          </motion.h2>
          <motion.p 
            className="max-w-2xl mx-auto text-gray-600"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            Unlock your culinary potential and build a sustainable cooking business with Local Cooks
          </motion.p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {mainBenefits.map((benefit, index) => (
            <motion.div 
              key={index}
              className="bg-white p-6 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 + 0.3 }}
            >
              <div className="mb-4 bg-gray-50 w-16 h-16 rounded-2xl flex items-center justify-center">
                {benefit.icon}
              </div>
              <h3 className="text-lg font-bold mb-2">{benefit.title}</h3>
              <p className="text-gray-600 text-sm">{benefit.description}</p>
            </motion.div>
          ))}
        </div>
        
        <motion.div 
          className="relative bg-gradient-to-br from-primary to-primary-dark rounded-2xl overflow-hidden shadow-xl"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <div className="absolute top-0 right-0 w-1/3 h-full opacity-10">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FFFFFF" d="M47.7,-51.2C59.1,-34.8,64,-15.5,62.4,2.4C60.9,20.3,52.8,36.9,39.9,47.7C27,58.5,9.2,63.5,-8.9,63.1C-27,62.8,-45.3,57.1,-56.9,44.3C-68.5,31.5,-73.4,11.7,-71.8,-8.2C-70.2,-28.1,-62.1,-48,-47.7,-64.5C-33.3,-80.9,-12.6,-93.9,3.3,-96.8C19.1,-99.8,36.2,-92.7,47.7,-79C59.1,-65.3,64,-34.8,64,-5.7L62.2,0.2L47.7,-51.2Z" transform="translate(100 100)" />
            </svg>
          </div>
          
          <div className="p-8 md:p-12 flex flex-col md:flex-row items-center relative z-10">
            <div className="md:w-1/2 mb-8 md:mb-0">
              <img 
                src="https://images.unsplash.com/photo-1556911220-bff31c812dba?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
                alt="Professional chef cooking" 
                className="rounded-xl shadow-lg w-full h-64 object-cover"
              />
            </div>
            
            <div className="md:w-1/2 md:pl-10 text-white">
              <h2 className="text-2xl md:text-3xl font-bold mb-6">Early Bird Advantages</h2>
              <p className="mb-6 opacity-90">
                Join during our trial phase and get exclusive benefits that won't be available later.
              </p>
              
              <ul className="space-y-4 mb-8">
                {pilotBenefits.map((benefit, index) => (
                  <motion.li 
                    key={index} 
                    className="flex items-start"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.4 }}
                  >
                    <div className="bg-white rounded-full p-1 mr-3 flex-shrink-0 mt-0.5">
                      {benefit.icon}
                    </div>
                    <div>
                      <div className="font-medium">{benefit.text}</div>
                      <div className="text-sm opacity-80">{benefit.description}</div>
                    </div>
                  </motion.li>
                ))}
              </ul>
              
              <Button 
                onClick={handleApplicationClick}
                size="lg"
                className="bg-white text-primary hover:bg-gray-100 font-bold py-3 px-8 rounded-full shadow-lg transform transition hover:-translate-y-1 hover:shadow-xl"
              >
                Apply Now
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
