import { motion } from "framer-motion";
import { Globe, Heart, Leaf, Quote } from "lucide-react";

const values = [
  {
    icon: <Heart className="h-6 w-6 text-white" />,
    bgColor: "bg-red-500",
    title: "Community Focus",
    description: "We're building more than a platform – we're creating a community where cooks and customers connect directly."
  },
  {
    icon: <Leaf className="h-6 w-6 text-white" />,
    bgColor: "bg-green-500",
    title: "Sustainability",
    description: "Our model reduces food waste and supports local food systems for a more sustainable future."
  },
  {
    icon: <Globe className="h-6 w-6 text-white" />,
    bgColor: "bg-blue-500",
    title: "Culinary Diversity",
    description: "We celebrate diverse cuisines and food traditions from every culture and corner of St. John's."
  }
];

export default function AboutSection() {
  // Removed button functionality as requested

  return (
    <section id="about" className="py-10 sm:py-12 md:py-16 px-4 sm:px-6 scroll-mt-24 bg-gradient-to-b from-white to-gray-50 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 opacity-5 pointer-events-none">
        <div className="absolute top-20 right-20 w-64 sm:w-80 md:w-96 h-64 sm:h-80 md:h-96 bg-[var(--color-primary)] rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 left-20 w-56 sm:w-64 md:w-80 h-56 sm:h-64 md:h-80 bg-[var(--color-gold)] rounded-full blur-3xl"></div>
      </div>
      
      <div className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-8 sm:mb-10 md:mb-12">
          <motion.span
            className="inline-block text-[var(--color-primary)] font-semibold mb-2 sm:mb-3 font-mono text-[10px] sm:text-xs md:text-sm uppercase tracking-widest px-3 sm:px-4 py-1.5 sm:py-2 bg-[var(--color-primary)]/10 rounded-full"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Our Story
          </motion.span>
          <motion.h2
            className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display text-[var(--color-primary)] mb-4 sm:mb-6 px-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Who We Are
          </motion.h2>
          <motion.p
            className="max-w-3xl mx-auto text-base sm:text-lg md:text-xl text-[var(--color-text-primary)] font-sans leading-relaxed px-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            A team of food enthusiasts passionate about empowering local cooks
          </motion.p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 sm:gap-8 md:gap-12 items-center mb-8 sm:mb-10 md:mb-12">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, type: "spring", stiffness: 100 }}
          >
            <div className="relative">
              <div className="absolute -top-6 -left-6 w-32 h-32 bg-[#F51042]/10 rounded-full blur-2xl"></div>
              <div className="absolute -bottom-6 -right-6 w-40 h-40 bg-[#F51042]/5 rounded-full blur-2xl"></div>

              <div className="relative bg-white p-6 sm:p-8 md:p-10 rounded-xl sm:rounded-2xl shadow-xl border border-gray-100 card-hover group overflow-hidden">
                {/* Decorative gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <div className="relative z-10">
                  <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
                    <div className="p-2.5 sm:p-3 bg-[var(--color-primary)]/10 rounded-lg sm:rounded-xl">
                      <Quote className="h-6 w-6 sm:h-8 sm:w-8 text-[var(--color-primary)]" />
                    </div>
                    <h3 className="text-xl sm:text-2xl md:text-3xl font-bold text-[var(--color-text-primary)]">Our Mission</h3>
                  </div>
                  <p className="text-[var(--color-text-primary)] mb-4 sm:mb-5 leading-relaxed font-sans text-sm sm:text-base md:text-lg">
                    Your kitchen holds stories, traditions, and flavors that deserve to be shared with the world. Local Cooks bridges the gap between your culinary gifts and the food lovers eager to discover them.
                  </p>
                  <p className="text-[var(--color-text-primary)] leading-relaxed font-sans text-sm sm:text-base md:text-lg">
                    We're not just a platform—we're a movement empowering passionate cooks to turn their authentic recipes into sustainable businesses, one homemade dish at a time. We're dedicated to supporting St. John's culinary community by connecting talented home cooks with hungry customers who appreciate authentic, homemade meals.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>

          <div className="space-y-4 sm:space-y-6 md:space-y-8">
            {values.map((value, index) => (
              <motion.div
                key={index}
                className="flex gap-4 sm:gap-5 items-start group cursor-pointer p-3 sm:p-4 rounded-xl hover:bg-white hover:shadow-lg transition-all duration-300"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 + 0.3, type: "spring", stiffness: 100 }}
                whileHover={{ x: 4, scale: 1.02 }}
              >
                <div className={`flex-shrink-0 ${value.bgColor} w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 rounded-lg sm:rounded-xl shadow-lg flex items-center justify-center group-hover:scale-110 group-hover:shadow-xl transition-all duration-300`}>
                  {value.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-xl md:text-2xl font-bold mb-1.5 sm:mb-2 md:mb-3 text-[var(--color-text-primary)] group-hover:text-[var(--color-primary)] transition-colors duration-300">{value.title}</h3>
                  <p className="text-[var(--color-text-primary)] font-sans text-sm sm:text-base md:text-lg leading-relaxed">{value.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
