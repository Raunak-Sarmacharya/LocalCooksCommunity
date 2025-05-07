import { ChefHat, Truck, Utensils, PackageCheck, Timer, DollarSign, CalendarClock, Monitor } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  {
    icon: <ChefHat className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-red-500 to-red-600",
    number: "01",
    title: "Create Your Menu",
    description: "Design a unique menu featuring your signature dishes and set your own pricing."
  },
  {
    icon: <CalendarClock className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-blue-500 to-blue-600",
    number: "02",
    title: "Cook On Your Schedule",
    description: "Prepare meals from your home or commercial kitchen when it works for you."
  },
  {
    icon: <PackageCheck className="h-8 w-8 text-white" />,
    bgColor: "bg-gradient-to-br from-green-500 to-green-600",
    number: "03",
    title: "We Handle Deliveries",
    description: "Our team takes care of all the logistics, from pickup to customer delivery."
  }
];

const benefits = [
  {
    icon: <Monitor className="h-5 w-5" />,
    title: "Easy-to-use Dashboard",
    description: "Manage orders and track earnings with our intuitive platform"
  },
  {
    icon: <Truck className="h-5 w-5" />,
    title: "Reliable Delivery",
    description: "Professional delivery service ensures your food arrives fresh"
  },
  {
    icon: <DollarSign className="h-5 w-5" />,
    title: "Weekly Payments",
    description: "Get paid directly to your account every week"
  },
  {
    icon: <Timer className="h-5 w-5" />,
    title: "Flexible Hours",
    description: "Set your own availability and cooking schedule"
  }
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-16 md:py-24 px-4 scroll-mt-24 bg-gradient-to-b from-white to-gray-50">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <motion.span 
            className="inline-block text-primary font-medium mb-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Simple Process
          </motion.span>
          <motion.h2 
            className="text-3xl md:text-4xl font-bold mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            How It Works
          </motion.h2>
          <motion.p 
            className="max-w-2xl mx-auto text-gray-600"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            Join our platform in three simple steps and start sharing your culinary creations with food lovers in your area
          </motion.p>
        </div>
        
        <div className="flex flex-col md:flex-row gap-6 mb-16">
          {steps.map((step, index) => (
            <motion.div 
              key={index}
              className="bg-white rounded-xl shadow-lg overflow-hidden flex-1 hover:shadow-xl transition-all hover:-translate-y-1"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 + 0.3 }}
            >
              <div className={`${step.bgColor} p-6 flex items-center justify-between`}>
                <div className="bg-white/20 p-3 rounded-lg backdrop-blur-sm">
                  {step.icon}
                </div>
                <span className="text-4xl font-bold text-white/40">{step.number}</span>
              </div>
              <div className="p-6">
                <h3 className="text-xl font-bold mb-3">{step.title}</h3>
                <p className="text-gray-600">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
        
        <div className="bg-white rounded-xl shadow-lg p-8 md:p-10">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h3 className="text-2xl font-bold mb-4">Everything You Need to Succeed</h3>
              <p className="text-gray-600 mb-6">
                Our platform provides all the tools and support you need to build a successful food business without the overhead of a traditional restaurant.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {benefits.map((benefit, index) => (
                  <motion.div 
                    key={index} 
                    className="flex gap-3"
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.3 }}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      {benefit.icon}
                    </div>
                    <div>
                      <h4 className="font-medium">{benefit.title}</h4>
                      <p className="text-sm text-gray-500">{benefit.description}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            
            <motion.div 
              className="relative"
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
            >
              <img 
                src="https://images.unsplash.com/photo-1507048331197-7d4ac70811cf?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80" 
                alt="Chef preparing meal" 
                className="rounded-lg shadow-lg object-cover h-full w-full"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent rounded-lg"></div>
              <div className="absolute bottom-6 left-6 right-6 bg-white/90 backdrop-blur-sm p-4 rounded-lg">
                <div className="flex items-center">
                  <Utensils className="h-5 w-5 text-primary mr-2" />
                  <p className="text-sm font-medium">Focus on cooking while we handle the business side</p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
}
