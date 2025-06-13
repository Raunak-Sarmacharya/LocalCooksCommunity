import { motion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";
import EnhancedAuthPage from "./EnhancedAuthPage";

export default function AuthDemo() {
  const [showDemo, setShowDemo] = useState(false);

  if (showDemo) {
    return <EnhancedAuthPage />;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-4xl mx-auto text-center"
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-8"
        >
          <motion.div
            className="flex items-center justify-center mb-4"
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.2 }}
          >
            <Sparkles className="w-8 h-8 text-blue-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-900">
              Enhanced Authentication Demo
            </h1>
          </motion.div>
          
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Experience the premium login/register flow with smooth animations, proper loading states, 
            and modern UX patterns inspired by Airbnb and Notion.
          </p>
        </motion.div>

        {/* Features Grid */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="grid md:grid-cols-2 gap-6 mb-12"
        >
          {[
            {
              title: "🎨 Smooth Animations",
              description: "Framer Motion powered transitions and micro-interactions"
            },
            {
              title: "⚡ Smart Loading States",
              description: "Elegant loading overlays with minimum timing for smooth UX"
            },
            {
              title: "📧 Email Verification",
              description: "Beautiful email verification screen with countdown timer"
            },
            {
              title: "🔐 Enhanced Security",
              description: "Real-time password strength indicator and validation"
            },
            {
              title: "📱 Mobile Optimized",
              description: "Touch-friendly design with responsive animations"
            },
            {
              title: "♿ Accessible",
              description: "Reduced motion support and keyboard navigation"
            }
          ].map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.6 + index * 0.1 }}
              whileHover={{ scale: 1.02, y: -2 }}
              className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-all duration-300"
            >
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {feature.title}
              </h3>
              <p className="text-gray-600 text-sm">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>

        {/* Technical Details */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.8 }}
          className="bg-white rounded-2xl p-8 shadow-xl mb-8"
        >
          <h2 className="text-2xl font-bold text-gray-900 mb-6">What's New?</h2>
          <div className="grid md:grid-cols-3 gap-6 text-left">
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">🎯 UX Improvements</h3>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Animated tab switching</li>
                <li>• Smooth form transitions</li>
                <li>• Real-time validation feedback</li>
                <li>• Success/error animations</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">⚙️ Technical Features</h3>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Framer Motion integration</li>
                <li>• TypeScript components</li>
                <li>• Custom hook validation</li>
                <li>• Responsive design system</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-3">🚀 Performance</h3>
              <ul className="text-sm text-gray-600 space-y-2">
                <li>• Optimized animations</li>
                <li>• Lazy loading states</li>
                <li>• Minimal bundle impact</li>
                <li>• 60fps smooth rendering</li>
              </ul>
            </div>
          </div>
        </motion.div>

        {/* Action Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 1.0 }}
          className="flex flex-col sm:flex-row gap-4 justify-center items-center"
        >
          <motion.button
            onClick={() => setShowDemo(true)}
            className="bg-blue-600 text-white px-8 py-4 rounded-xl font-semibold text-lg shadow-lg hover:shadow-xl transition-all duration-300"
            whileHover={{ scale: 1.05, backgroundColor: "#2563eb" }}
            whileTap={{ scale: 0.98 }}
          >
            🚀 Try Enhanced Auth Experience
          </motion.button>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/auth"
              className="bg-gray-100 text-gray-700 px-8 py-4 rounded-xl font-semibold text-lg border border-gray-300 hover:bg-gray-200 transition-all duration-300 inline-block"
            >
              View Current Auth Page
            </Link>
          </motion.div>
        </motion.div>

        {/* Back Button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.2 }}
          className="mt-12"
        >
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Link
              href="/"
              className="inline-flex items-center text-gray-600 hover:text-gray-900 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
} 