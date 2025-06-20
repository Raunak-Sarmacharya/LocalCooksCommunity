import { motion } from "framer-motion";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";

export default function EmailAction() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [actionType, setActionType] = useState<string | null>(null);

  useEffect(() => {
    const handleEmailAction = async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const mode = urlParams.get('mode');
        const oobCode = urlParams.get('oobCode');
        const email = urlParams.get('email');

        console.log('📧 Email action detected:', { 
          mode, 
          oobCode: oobCode?.substring(0, 8) + '...', 
          email, 
          hasEmail: !!email,
          allParams: Object.fromEntries(urlParams.entries())
        });

        if (!mode || !oobCode) {
          throw new Error('Invalid email action link');
        }

        setActionType(mode);

        switch (mode) {
          case 'verifyEmail':
            // For email verification, we don't need to call an API
            // Firebase automatically verifies the email when this link is accessed
            console.log('✅ Email verification link accessed');
            setStatus('success');
            setMessage('Your email has been verified successfully! You can now log in to your account.');
            
            // Redirect to auth page after 3 seconds
            setTimeout(() => {
              setLocation('/auth?verified=true');
            }, 3000);
            break;

          case 'resetPassword':
            // For password reset, redirect to password reset page with the code and email
            console.log('🔄 Redirecting to password reset page');
            
            // Firebase reset links don't always include email in URL params
            // We'll handle this in the password reset form by extracting email from the oobCode
            const resetUrl = `/password-reset?oobCode=${oobCode}&mode=resetPassword${email ? `&email=${encodeURIComponent(email)}` : ''}`;
            console.log('🔗 Reset URL:', resetUrl);
            setLocation(resetUrl);
            break;

          default:
            throw new Error(`Unknown action mode: ${mode}`);
        }
      } catch (error: any) {
        console.error('❌ Email action error:', error);
        setStatus('error');
        setMessage(error.message || 'Invalid or expired link');
        
        // Redirect to auth page after 5 seconds
        setTimeout(() => {
          setLocation('/auth');
        }, 5000);
      }
    };

    handleEmailAction();
  }, [setLocation]);

  const getIcon = () => {
    switch (status) {
      case 'loading':
        return <Loader2 className="w-16 h-16 text-blue-600 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="w-16 h-16 text-green-600" />;
      case 'error':
        return <XCircle className="w-16 h-16 text-red-600" />;
    }
  };

  const getTitle = () => {
    switch (status) {
      case 'loading':
        return actionType === 'verifyEmail' ? 'Verifying your email...' : 'Processing...';
      case 'success':
        return actionType === 'verifyEmail' ? 'Email verified!' : 'Success!';
      case 'error':
        return 'Something went wrong';
    }
  };

  const getColor = () => {
    switch (status) {
      case 'loading':
        return 'text-blue-600';
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
          className="mb-6 flex justify-center"
        >
          {getIcon()}
        </motion.div>

        <motion.h1 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={`text-2xl font-bold mb-4 ${getColor()}`}
        >
          {getTitle()}
        </motion.h1>

        <motion.p 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-gray-600 mb-6"
        >
          {message}
        </motion.p>

        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-sm text-gray-500"
          >
            Redirecting you in a moment...
          </motion.div>
        )}

        {status === 'error' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={() => setLocation('/auth')}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Go to Login
          </motion.button>
        )}
      </motion.div>
    </div>
  );
} 