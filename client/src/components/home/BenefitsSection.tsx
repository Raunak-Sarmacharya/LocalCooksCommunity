import { useFirebaseAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { Calendar, Camera, CreditCard, Medal, Megaphone, Settings, TrendingUp, Wallet } from "lucide-react";
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


export default function BenefitsSection() {
  const { user } = useFirebaseAuth();

  // Determine which benefits to show based on user role
  const getBenefits = () => {
    return chefBenefits;
  };

  const getTitle = () => {
    return "Benefits for Cooks";
  };

  const getDescription = () => {
    return "Unlock your culinary potential and build a sustainable cooking business with Local Cooks";
  };

  const mainBenefits = getBenefits();

  return (
    <section id="benefits" className="py-10 sm:py-12 md:py-16 px-4 sm:px-6 bg-gradient-to-b from-cream/30 to-white scroll-mt-24">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 sm:mb-10">
          <motion.span
            className="inline-block text-brand-primary font-medium mb-2 font-mono text-[10px] sm:text-xs uppercase tracking-wider"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Why Join Us
          </motion.span>
          <motion.h2
            className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-display text-brand-primary mb-3 sm:mb-4 px-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            {getTitle()}
          </motion.h2>
          <motion.p
            className="max-w-2xl mx-auto text-sm sm:text-base md:text-lg text-brand-text font-sans px-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            {getDescription()}
          </motion.p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8 mb-8 sm:mb-10">
          {mainBenefits.map((benefit, index) => (
            <motion.div
              key={index}
              className="bg-white p-6 md:p-8 rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 group card-hover border border-gray-100 relative overflow-hidden"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 + 0.3, type: "spring", stiffness: 100 }}
              whileHover={{ y: -8, scale: 1.02 }}
            >
              {/* Decorative gradient overlay on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              <div className="relative z-10">
                <div className="mb-3 sm:mb-4 md:mb-6 bg-gradient-to-br from-gray-50 to-gray-100 w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-xl sm:rounded-2xl flex items-center justify-center shadow-md group-hover:shadow-lg group-hover:scale-110 transition-all duration-300">
                  {benefit.icon}
                </div>
                <h3 className="text-base sm:text-lg md:text-xl font-bold mb-2 sm:mb-3 text-brand-text group-hover:text-brand-primary transition-colors duration-300">{benefit.title}</h3>
                <p className="text-xs sm:text-sm md:text-base text-brand-text/80 font-sans leading-relaxed">{benefit.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          className="relative bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 rounded-3xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.4)] md:shadow-[0_30px_60px_rgba(0,0,0,0.5)] transform scale-100 md:scale-105 border border-gray-600/20"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, type: "spring", stiffness: 100 }}
          whileHover={{ scale: 1.02, y: -4 }}
        >
          <div className="absolute top-0 right-0 w-[17.5%] h-full opacity-5">
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
              <path fill="#FFFFFF" d="M47.7,-51.2C59.1,-34.8,64,-15.5,62.4,2.4C60.9,20.3,52.8,36.9,39.9,47.7C27,58.5,9.2,63.5,-8.9,63.1C-27,62.8,-45.3,57.1,-56.9,44.3C-68.5,31.5,-73.4,11.7,-71.8,-8.2C-70.2,-28.1,-62.1,-48,-47.7,-64.5C-33.3,-80.9,-12.6,-93.9,3.3,-96.8C19.1,-99.8,36.2,-92.7,47.7,-79C59.1,-65.3,64,-34.8,64,-5.7L62.2,0.2L47.7,-51.2Z" transform="translate(100 100)" />
            </svg>
          </div>

          <div className="p-4 sm:p-6 md:p-10 lg:p-14 flex flex-col md:flex-row items-center relative z-10">
            <div className="md:w-1/2 mb-6 md:mb-0 relative group w-full">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/20 to-transparent rounded-xl md:rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <img
                src={foodDeliveryImage}
                alt="Chef delivering food to customer at doorstep"
                className="rounded-xl md:rounded-2xl w-full h-40 sm:h-48 md:h-60 lg:h-72 object-cover shadow-[0_10px_30px_rgba(0,0,0,0.3)] md:shadow-[0_15px_40px_rgba(0,0,0,0.4)] group-hover:scale-105 transition-transform duration-500"
              />
            </div>

            <div className="md:w-1/2 md:pl-6 lg:pl-8 xl:pl-10 text-white w-full">
              <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold mb-4 sm:mb-5 md:mb-6 text-shadow-lg leading-tight">Early Bird Advantages</h2>
              <p className="text-base sm:text-lg md:text-xl mb-4 sm:mb-6 md:mb-8 opacity-95 text-shadow-md leading-relaxed">
                Join during our trial phase and get exclusive benefits that won't be available later.
              </p>

              <ul className="space-y-3 sm:space-y-4 md:space-y-5 mb-4 sm:mb-6 md:mb-8">
                {pilotBenefits.map((benefit, index) => (
                  <motion.li
                    key={index}
                    className="flex items-start group/item"
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.4, type: "spring", stiffness: 100 }}
                    whileHover={{ x: 4 }}
                  >
                    <div className="bg-white/95 rounded-full p-1.5 sm:p-2 mr-3 sm:mr-4 flex-shrink-0 mt-0.5 shadow-lg group-hover/item:scale-110 group-hover/item:shadow-xl transition-all duration-300">
                      {benefit.icon}
                    </div>
                    <div>
                      <div className="font-semibold text-base sm:text-lg md:text-xl text-shadow-sm mb-0.5 sm:mb-1">{benefit.text}</div>
                      <div className="text-xs sm:text-sm md:text-base opacity-90 text-shadow-xs leading-relaxed">{benefit.description}</div>
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
