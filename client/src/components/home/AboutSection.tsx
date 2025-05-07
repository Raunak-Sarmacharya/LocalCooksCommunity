import { Leaf, Heart, Globe, Users, Quote } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

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
  const [, navigate] = useLocation();
  
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
              
              <div className="relative bg-white p-6 rounded-xl shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <Quote className="h-10 w-10 text-primary/30" />
                  <h3 className="text-xl font-semibold">Our Mission</h3>
                </div>
                <p className="text-gray-700 mb-4 leading-relaxed">
                  To create a sustainable food ecosystem that celebrates local cuisines, reduces waste, 
                  and brings people together through the universal language of good food.
                </p>
                <p className="text-gray-700 leading-relaxed">
                  We're dedicated to supporting St. John's culinary community by connecting 
                  talented home cooks with hungry customers who appreciate authentic, homemade meals.
                </p>
                
                <div className="mt-8 flex flex-wrap gap-4">
                  <Button 
                    onClick={() => navigate("/apply")}
                    className="rounded-full px-6"
                  >
                    Join Our Community
                  </Button>
                </div>
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
        
        <motion.div 
          className="bg-gray-50 rounded-2xl p-8 md:p-10 shadow-lg overflow-hidden"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
        >
          <div className="grid md:grid-cols-5 gap-8 items-center">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <Users className="h-6 w-6 text-primary" />
                <h3 className="text-xl font-bold">Meet Our Team</h3>
              </div>
              <p className="text-gray-600 mb-6">
                We're a diverse team of chefs, food enthusiasts, and tech experts working together 
                to revolutionize how local food is shared and enjoyed.
              </p>
              <p className="text-gray-600">
                By joining Local Cooks, you become part of a movement that values authentic 
                flavors and community connections.
              </p>
            </div>
            
            <div className="md:col-span-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <img 
                  src="https://images.unsplash.com/photo-1507048331197-7d4ac70811cf?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" 
                  alt="Home cooking" 
                  className="rounded-lg shadow-md h-24 md:h-32 w-full object-cover transition-transform hover:scale-105"
                />
                <img 
                  src="https://images.unsplash.com/photo-1576867757603-05b134ebc379?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" 
                  alt="Food delivery service" 
                  className="rounded-lg shadow-md h-24 md:h-32 w-full object-cover transition-transform hover:scale-105"
                />
                <img 
                  src="https://images.unsplash.com/photo-1593504049359-74330189a345?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" 
                  alt="Home cooking" 
                  className="rounded-lg shadow-md h-24 md:h-32 w-full object-cover transition-transform hover:scale-105"
                />
                <img 
                  src="https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?ixlib=rb-1.2.1&auto=format&fit=crop&w=400&q=80" 
                  alt="Local food community" 
                  className="rounded-lg shadow-md h-24 md:h-32 w-full object-cover transition-transform hover:scale-105"
                />
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
