import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { getRoleLoginOrigin } from "@shared/subdomain-utils";
import ForgotPasswordForm from "../components/auth/ForgotPasswordForm";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [emailSent, setEmailSent] = useState(false);

  // Get role from URL params, fallback to hostname detection
  const urlParams = new URLSearchParams(window.location.search);
  let role = urlParams.get('role');

  // Fallback: detect role from current hostname so the correct endpoint is always called
  if (!role) {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes('kitchen') || hostname.startsWith('kitchen.')) {
      role = 'manager';
    } else if (hostname.includes('admin') || hostname.startsWith('admin.')) {
      role = 'admin';
    } else if (hostname.includes('chef') || hostname.startsWith('chef.')) {
      role = 'chef';
    }
  }

  const handleSuccess = () => {
    setEmailSent(true);
  };

  const handleGoBack = () => {
    const isLocalhost = window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.endsWith('.localhost');

    if (isLocalhost) {
      const redirectPath = role === 'manager' ? '/manager/login' : '/auth';
      setLocation(redirectPath);
      return;
    }

    const redirectPaths: Record<string, string> = {
      manager: '/manager/login',
      chef: '/auth',
      admin: '/admin/login',
    };

    const detectedRole = role || 'chef';
    const subdomain = getRoleLoginOrigin(detectedRole, window.location.hostname, {
      vercelEnv: import.meta.env.VITE_VERCEL_ENV,
    });
    const path = redirectPaths[detectedRole] || redirectPaths.chef;
    window.location.href = `${subdomain}${path}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex flex-col">
      {/* Back Button - Now at the top */}
      <div className="p-6">
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          onClick={handleGoBack}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          <span>Back to {role === 'manager' ? 'Manager ' : ''}Login</span>
        </motion.button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8"
          >
            <ForgotPasswordForm
              onSuccess={handleSuccess}
              onGoBack={handleGoBack}
              role={role || undefined}
            />
          </motion.div>
        </div>
      </div>
    </div>
  );
} 