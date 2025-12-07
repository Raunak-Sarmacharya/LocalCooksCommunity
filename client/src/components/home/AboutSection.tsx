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
    <section id="about" className="py-16 md:py-24 px-4 scroll-mt-24 bg-gradient-to-b from-gray-50 to-white relative overflow-hidden">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-16">
          <motion.span
            className="inline-block text-primary font-medium mb-2"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
          >
            Our Story
          </motion.span>
          <motion.h2
            className="text-3xl md:text-4xl font-bold mb-4"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
          >
            Who We Are
          </motion.h2>
          <motion.p
            className="max-w-2xl mx-auto text-gray-600"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 }}
          >
            A team of food enthusiasts passionate about empowering local cooks
          </motion.p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 items-center mb-16">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
          >
            <div className="relative">
              <div className="absolute -top-4 -left-4 w-24 h-24 bg-primary/10 rounded-full"></div>
              <div className="absolute -bottom-4 -right-4 w-32 h-32 bg-primary/5 rounded-full"></div>

              <div className="relative bg-white p-6 rounded-xl shadow-xl card-hover">
                <div className="flex items-center gap-3 mb-4">
                  <Quote className="h-10 w-10 text-primary/30" />
                  <h3 className="text-xl font-semibold">Our Mission</h3>
                </div>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  Your kitchen holds stories, traditions, and flavors that deserve to be shared with the world. Local Cooks bridges the gap between your culinary gifts and the food lovers eager to discover them.
                </p>
                <p className="text-gray-700 leading-relaxed">
                  We're not just a platform—we're a movement empowering passionate cooks to turn their authentic recipes into sustainable businesses, one homemade dish at a time. We're dedicated to supporting St. John's culinary community by connecting talented home cooks with hungry customers who appreciate authentic, homemade meals.
                </p>


              </div>
            </div>
          </motion.div>

          <div className="space-y-6">
            {values.map((value, index) => (
              <motion.div
                key={index}
                className="flex gap-4 items-start"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 + 0.3 }}
              >
                <div className={`flex-shrink-0 ${value.bgColor} w-12 h-12 rounded-lg shadow-lg flex items-center justify-center`}>
                  {value.icon}
                </div>
                <div>
                  <h3 className="text-lg font-bold mb-2">{value.title}</h3>
                  <p className="text-gray-600">{value.description}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
