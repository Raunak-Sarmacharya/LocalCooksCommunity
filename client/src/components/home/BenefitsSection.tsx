import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { Calendar, Camera, Clock, CreditCard, DollarSign, Medal, Megaphone, Route, Settings, TrendingUp, Truck, Wallet } from "lucide-react";
import foodDeliveryImage from "../../assets/food-delivery.png";

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

// Chef benefits
const chefBenefits = [
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

// Delivery partner benefits
const deliveryBenefits = [
  {
    title: "Flexible Hours",
    icon: <Clock className="h-10 w-10 text-blue-500" />,
    description: "Choose your own schedule and work as much or as little as you want"
  },
  {
    title: "Competitive Earnings",
    icon: <DollarSign className="h-10 w-10 text-green-500" />,
    description: "Earn competitive rates per delivery plus tips, with transparent pricing"
  },
  {
    title: "Optimized Routes",
    icon: <Route className="h-10 w-10 text-purple-500" />,
    description: "Smart routing helps you complete more deliveries efficiently and maximize earnings"
  },
  {
    title: "Vehicle Support",
    icon: <Truck className="h-10 w-10 text-amber-500" />,
    description: "Support for cars, SUVs, trucks, and vans – use what you already have"
  }
];

// Dual role benefits
const dualBenefits = [
  {
    title: "Dual Income Streams",
    icon: <Wallet className="h-10 w-10 text-amber-500" />,
    description: "Maximize earnings by both cooking delicious meals and delivering for the community"
  },
  {
    title: "Complete Control",
    icon: <Calendar className="h-10 w-10 text-blue-500" />,
    description: "Manage both businesses from one platform with complete schedule flexibility"
  },
  {
    title: "Community Connection",
    icon: <TrendingUp className="h-10 w-10 text-green-500" />,
    description: "Build deeper relationships as both a chef and delivery partner in your community"
  },
  {
    title: "Unified Tools",
    icon: <Settings className="h-10 w-10 text-purple-500" />,
    description: "One dashboard to manage your chef business, delivery schedule, and all earnings"
  }
];

export default function BenefitsSection() {
  const { user } = useFirebaseAuth();
  
  // Determine which benefits to show based on user roles
  const getBenefits = () => {
    const isChef = (user as any)?.isChef;
    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
    
    if (isChef && isDeliveryPartner) {
      return dualBenefits;
    } else if (isDeliveryPartner) {
      return deliveryBenefits;
    } else {
      return chefBenefits;
    }
  };
  
  const getTitle = () => {
    const isChef = (user as any)?.isChef;
    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
    
    if (isChef && isDeliveryPartner) {
      return "Benefits for Chef & Delivery Partners";
    } else if (isDeliveryPartner) {
      return "Benefits for Delivery Partners";
    } else {
      return "Benefits for Cooks";
    }
  };
  
  const getDescription = () => {
    const isChef = (user as any)?.isChef;
    const isDeliveryPartner = (user as any)?.isDeliveryPartner;
    
    if (isChef && isDeliveryPartner) {
      return "Maximize your potential with dual roles in our local food ecosystem";
    } else if (isDeliveryPartner) {
      return "Join our delivery network and earn money while serving your community";
    } else {
      return "Unlock your culinary potential and build a sustainable cooking business with Local Cooks";
    }
  };
  
  const mainBenefits = getBenefits();
  
  return (
    <section id="benefits" className="py-16 md:py-24 px-4 bg-gradient-to-b from-blue-50 to-white scroll-mt-24">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-12 md:mb-16">
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
            {getTitle()}
          </motion.h2>
          <motion.p 
            className="max-w-2xl mx-auto text-gray-600"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            {getDescription()}
          </motion.p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {mainBenefits.map((benefit, index) => (
            <motion.div 
              key={index}
              className="bg-white p-4 md:p-6 rounded-xl shadow-lg hover:shadow-xl hover-shadow hover:-translate-y-1 hover-transform group"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 + 0.3 }}
            >
              <div className="mb-3 md:mb-4 bg-gray-50 w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center">
                {benefit.icon}
              </div>
              <h3 className="text-base md:text-lg font-bold mb-1 md:mb-2 text-gray-900">{benefit.title}</h3>
              <p className="text-xs md:text-sm text-gray-600">{benefit.description}</p>
            </motion.div>
          ))}
        </div>
        
        <motion.div 
          className="relative bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 rounded-2xl md:rounded-3xl overflow-hidden shadow-[0_10px_25px_rgba(0,0,0,0.4)] md:shadow-[0_20px_50px_rgba(0,0,0,0.5)] transform scale-100 md:scale-105"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <div className="absolute top-0 right-0 w-[17.5%] h-full opacity-5">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FFFFFF" d="M47.7,-51.2C59.1,-34.8,64,-15.5,62.4,2.4C60.9,20.3,52.8,36.9,39.9,47.7C27,58.5,9.2,63.5,-8.9,63.1C-27,62.8,-45.3,57.1,-56.9,44.3C-68.5,31.5,-73.4,11.7,-71.8,-8.2C-70.2,-28.1,-62.1,-48,-47.7,-64.5C-33.3,-80.9,-12.6,-93.9,3.3,-96.8C19.1,-99.8,36.2,-92.7,47.7,-79C59.1,-65.3,64,-34.8,64,-5.7L62.2,0.2L47.7,-51.2Z" transform="translate(100 100)" />
            </svg>
          </div>
          
          <div className="p-6 md:p-10 lg:p-14 flex flex-col md:flex-row items-center relative z-10">
            <div className="md:w-1/2 mb-6 md:mb-0">
              <img 
                src={foodDeliveryImage} 
                alt="Chef delivering food to customer at doorstep" 
                className="rounded-xl md:rounded-2xl w-full h-48 sm:h-60 md:h-72 object-cover shadow-[0_5px_15px_rgba(0,0,0,0.2)] md:shadow-[0_10px_25px_rgba(0,0,0,0.3)]"
              />
            </div>
            
            <div className="md:w-1/2 md:pl-8 lg:pl-10 text-white">
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold mb-4 md:mb-6 text-shadow-lg">Early Bird Advantages</h2>
              <p className="text-base md:text-lg mb-4 md:mb-6 opacity-95 text-shadow-md">
                Join during our trial phase and get exclusive benefits that won't be available later.
              </p>
              
              <ul className="space-y-3 md:space-y-5 mb-6 md:mb-8">
                {pilotBenefits.map((benefit, index) => (
                  <motion.li 
                    key={index} 
                    className="flex items-start"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.4 }}
                  >
                    <div className="bg-white/90 rounded-full p-1.5 mr-4 flex-shrink-0 mt-0.5 shadow-sm">
                      {benefit.icon}
                    </div>
                    <div>
                      <div className="font-medium text-lg text-shadow-sm">{benefit.text}</div>
                      <div className="text-sm opacity-85 text-shadow-xs">{benefit.description}</div>
                    </div>
                  </motion.li>
                ))}
              </ul>
              

            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
