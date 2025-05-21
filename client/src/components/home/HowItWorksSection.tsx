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
            Join our platform in three simple steps and start sharing your culinary creations with food lovers in your area.
          </motion.p>
        </div>

        <div className="flex flex-col md:flex-row gap-8 mb-20">
          {steps.map((step, index) => (
            <motion.div
              key={index}
              className="bg-white rounded-2xl shadow-lg overflow-hidden flex-1 hover:shadow-xl hover-standard hover:-translate-y-2 border border-gray-100 group"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 + 0.3 }}
            >
              <div className={`${step.bgColor} p-7 flex items-center justify-between relative`}>
                <div className="bg-white/25 p-3 rounded-xl backdrop-blur-sm ring-1 ring-white/30">
                  {step.icon}
                </div>
                <span className="text-5xl font-bold text-white/30 tracking-tight">{step.number}</span>
                <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2 w-8 h-8 rotate-45 bg-white"></div>
              </div>
              <div className="p-8 relative z-10">
                <h3 className="text-xl font-bold mb-3 group-hover:text-primary hover-text">{step.title}</h3>
                <p className="text-gray-600 leading-relaxed group-hover:text-primary/80 hover-text">{step.description}</p>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 md:p-12 border border-gray-100">
          <div className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <h3 className="text-2xl font-bold mb-4">Everything You Need to Succeed</h3>
              <p className="text-gray-600 mb-8 leading-relaxed">
                Our platform provides all the tools and support you need to build a successful food business without the overhead of a traditional restaurant.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {benefits.map((benefit, index) => (
                  <motion.div
                    key={index}
                    className="flex gap-4 group"
                    initial={{ opacity: 0, x: -10 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 + 0.3 }}
                  >
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary/20 hover-standard">
                      {benefit.icon}
                    </div>
                    <div className="hover-text">
                      <h4 className="font-bold text-gray-900 mb-1 group-hover:text-primary hover-text">{benefit.title}</h4>
                      <p className="text-gray-600 leading-relaxed group-hover:text-primary/80 hover-text">{benefit.description}</p>
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
                className="rounded-xl shadow-lg object-cover h-full w-full"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/10 rounded-xl"></div>
              <div className="absolute bottom-6 left-6 right-6 bg-white/95 backdrop-blur-sm p-5 rounded-xl shadow-lg">
                <div className="flex items-center">
                  <Utensils className="h-6 w-6 text-primary mr-3" />
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
