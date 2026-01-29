import { ChefHat, Truck, Utensils, PackageCheck, Timer, DollarSign, CalendarClock, Monitor } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    icon: <ChefHat className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-orange-500 to-rose-600",
    number: "01",
    title: "Create Your Menu",
    description: "Design a unique menu featuring your signature dishes and set your own pricing."
  },
  {
    icon: <CalendarClock className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-blue-500 to-indigo-600",
    number: "02",
    title: "Cook On Your Schedule",
    description: "Prepare meals from your home or commercial kitchen when it works for you."
  },
  {
    icon: <PackageCheck className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-purple-500 to-violet-600",
    number: "03",
    title: "Your Culinary Connection",
    description: "We connect you with a growing community of local food lovers and manage all the delivery logistics, so you can focus on what you do best: cooking!"
  }
];

const benefits = [
  {
    icon: <Monitor className="h-6 w-6" />,
    title: "Easy-to-use Dashboard",
    description: "Manage orders and track earnings with our intuitive platform"
  },
  {
    icon: <Truck className="h-6 w-6" />,
    title: "Delivery Handled For You",
    description: "We take care of all delivery logistics so your food reaches customers fresh"
  },
  {
    icon: <DollarSign className="h-6 w-6" />,
    title: "Weekly Payments",
    description: "Get paid directly to your account every week"
  },
  {
    icon: <Timer className="h-6 w-6" />,
    title: "Community Connection",
    description: "Build relationships with local customers who love your unique cuisine"
  }
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-10 sm:py-12 md:py-16 px-4 sm:px-6 scroll-mt-24 bg-gradient-to-b from-white via-gray-50 to-white relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute top-40 left-10 w-64 sm:w-80 md:w-96 h-64 sm:h-80 md:h-96 bg-brand-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-40 right-10 w-56 sm:w-64 md:w-80 h-56 sm:h-64 md:h-80 bg-gold rounded-full blur-3xl"></div>
      </div>

      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-8 sm:mb-10 md:mb-12">
          <motion.span
            className="inline-block text-brand-primary font-semibold mb-2 sm:mb-3 font-mono text-[10px] sm:text-xs md:text-sm uppercase tracking-widest px-3 sm:px-4 py-1.5 sm:py-2 bg-brand-primary/10 rounded-full"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Simple Process
          </motion.span>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display text-brand-primary mb-4 sm:mb-6 px-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            How It Works
          </motion.h2>
          <motion.p
            className="max-w-3xl mx-auto text-base sm:text-lg md:text-xl text-brand-text font-sans leading-relaxed px-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            Join our platform in three simple steps and start sharing your culinary creations with food lovers in your area.
          </motion.p>
        </div>

        <div className="flex flex-col md:flex-row gap-6 sm:gap-8 md:gap-10 mb-12 sm:mb-14 md:mb-16">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              className="bg-white rounded-3xl shadow-xl overflow-hidden flex-1 hover:shadow-2xl transition-all duration-300 border border-gray-100 group card-hover relative"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.15 + 0.3, type: "spring", stiffness: 100 }}
              whileHover={{ y: -12, scale: 1.02 }}
            >
              {/* Decorative gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>

              <div className={`${step.bgColor} p-6 sm:p-8 md:p-10 flex items-center justify-between relative overflow-hidden`}>
                {/* Animated background pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 right-0 w-24 sm:w-32 h-24 sm:h-32 bg-white/20 rounded-full blur-2xl"></div>
                  <div className="absolute bottom-0 left-0 w-20 sm:w-24 h-20 sm:h-24 bg-white/20 rounded-full blur-2xl"></div>
                </div>

                <div className="bg-white/30 p-3 sm:p-4 rounded-xl sm:rounded-2xl backdrop-blur-md ring-2 ring-white/40 group-hover:scale-110 transition-transform duration-300 relative z-10">
                  {step.icon}
                </div>
                <span className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white/20 tracking-tight relative z-10">{step.number}</span>
                <div className="absolute -bottom-4 sm:-bottom-6 left-1/2 transform -translate-x-1/2 w-8 h-8 sm:w-12 sm:h-12 rotate-45 bg-white shadow-lg"></div>
              </div>
              <div className="p-6 sm:p-8 md:p-10 relative z-10">
                <h3 className="text-xl sm:text-2xl md:text-3xl font-bold mb-3 sm:mb-4 text-brand-text group-hover:text-brand-primary transition-colors duration-300">{step.title}</h3>
                <p className="text-brand-text leading-relaxed font-sans text-sm sm:text-base md:text-lg">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 md:p-10 lg:p-14 border border-gray-100 relative overflow-hidden group">
          {/* Decorative gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-brand-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

          <div className="grid md:grid-cols-2 gap-8 sm:gap-10 md:gap-12 items-center relative z-10">
            <div>
              <h3 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4 sm:mb-5 text-brand-text group-hover:text-brand-primary transition-colors duration-300">Everything You Need to Succeed</h3>
              <p className="text-base sm:text-lg md:text-xl text-brand-text mb-6 sm:mb-8 md:mb-10 leading-relaxed font-sans">
                Our platform provides all the tools and support you need to build a successful food business without the overhead of a traditional restaurant.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-8">
                {benefits.map((benefit, index) => (
                  <motion.div
                    key={index}
                    className="flex gap-4 group/item p-4 rounded-xl hover:bg-gray-50 transition-all duration-300 cursor-pointer"
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.3, type: "spring", stiffness: 100 }}
                    whileHover={{ x: 4, scale: 1.02 }}
                  >
                    <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-xl bg-gradient-to-br from-brand-primary/15 to-brand-primary/5 flex items-center justify-center text-brand-primary group-hover/item:bg-gradient-to-br group-hover/item:from-brand-primary/25 group-hover/item:to-brand-primary/10 group-hover/item:scale-110 transition-all duration-300 shadow-md">
                      {benefit.icon}
                    </div>
                    <div>
                      <h4 className="font-bold text-base sm:text-lg text-brand-text mb-1.5 sm:mb-2 group-hover/item:text-brand-primary transition-colors duration-300">{benefit.title}</h4>
                      <p className="text-brand-text leading-relaxed font-sans text-sm sm:text-base">{benefit.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            <motion.div
              className="relative group/feature"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3, type: "spring", stiffness: 100 }}
              whileHover={{ scale: 1.05 }}
            >
              <div className="bg-gradient-to-br from-brand-primary/15 via-brand-primary/10 to-cream rounded-xl sm:rounded-2xl shadow-xl p-8 sm:p-10 md:p-12 lg:p-16 h-full flex items-center justify-center relative overflow-hidden">
                {/* Animated background pattern */}
                <div className="absolute inset-0 opacity-10">
                  <div className="absolute top-0 right-0 w-32 sm:w-40 h-32 sm:h-40 bg-brand-primary rounded-full blur-3xl"></div>
                  <div className="absolute bottom-0 left-0 w-24 sm:w-32 h-24 sm:h-32 bg-gold rounded-full blur-3xl"></div>
                </div>

                <div className="text-center relative z-10">
                  <div className="mb-4 sm:mb-6 inline-block p-3 sm:p-4 bg-white/20 rounded-xl sm:rounded-2xl backdrop-blur-sm group-hover/feature:scale-110 transition-transform duration-300">
                    <Utensils className="h-16 w-16 sm:h-20 sm:w-20 text-brand-primary mx-auto" />
                  </div>
                  <p className="text-lg sm:text-xl md:text-2xl font-bold text-brand-text font-sans leading-relaxed px-2">Focus on cooking while we handle the business side</p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
