import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { 
  ArrowRight, 
  CheckCircle, 
  ChefHat
} from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';

interface WelcomeScreenProps {
  onComplete?: () => void;
  onContinue?: () => void;
}

export default function WelcomeScreen({ onComplete, onContinue }: WelcomeScreenProps) {
  const { user } = useFirebaseAuth();
  const [isCompleting, setIsCompleting] = useState(false);

  // Detect authentication method
  const getAuthMethod = () => {
    if (!auth.currentUser) return 'unknown';
    
    const providers = auth.currentUser.providerData.map((p: any) => p.providerId);
    if (providers.includes('google.com')) {
      return 'google';
    } else if (providers.includes('password')) {
      return 'email';
    }
    return 'unknown';
  };

  const authMethod = getAuthMethod();

  // Dynamic message based on authentication method
  const getVerificationMessage = () => {
    switch (authMethod) {
      case 'google':
        return 'Since you signed in with Google, your account is automatically verified!';
      case 'email':
        return 'Your email has been verified and your account is ready to use!';
      default:
        return 'Your account is verified and ready to go!';
    }
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      // Get current Firebase user and token
      const currentUser = auth.currentUser;
      if (currentUser) {
        console.log("🎉 Marking welcome screen as seen for user:", currentUser.uid);
        const token = await currentUser.getIdToken();
        
        const response = await fetch('/api/user/seen-welcome', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const result = await response.json();
          console.log("✅ Welcome screen completion response:", result);
        } else {
          const errorText = await response.text();
          console.warn("⚠️ Welcome screen API call failed:", response.status, errorText);
        }
      } else {
        console.warn("⚠️ No Firebase user available when completing welcome screen");
      }
      
      console.log("✅ Welcome screen completed, proceeding to callback");
      const callback = onComplete || onContinue;
      if (callback) callback();
    } catch (error) {
      console.error('❌ Error completing welcome screen:', error);
      // Still allow them to continue even if backend call fails
      console.log("🔄 Continuing despite error...");
      const callback = onComplete || onContinue;
      if (callback) callback();
    } finally {
      setIsCompleting(false);
    }
  };

  const userName = user?.displayName || user?.email?.split('@')[0] || 'Chef';

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-rose-50">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-32 h-32 bg-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-orange-400 rounded-full blur-3xl"></div>
      </div>

      <div className="relative px-4 py-6 md:py-8">
        <div className="max-w-5xl mx-auto">
          {/* Welcome Header - Sleek and Compact */}
          <motion.div 
            className="text-center mb-8 md:mb-12"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-4">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            
            <h1 className="text-2xl md:text-4xl font-bold mb-3">
              Welcome to <span className="font-logo text-primary">Local Cooks</span>, {userName}! 🎉
            </h1>
            
            <p className="text-base md:text-lg text-gray-600 mb-4 max-w-xl mx-auto">
              Your application journey starts here. Let's get you onboarded to our platform.
            </p>
            
            <div className="inline-flex items-center px-3 py-1.5 bg-green-50 rounded-full border border-green-200">
              <CheckCircle className="h-3 w-3 text-green-600 mr-2" />
              <span className="text-xs text-green-800 font-medium">
                {getVerificationMessage()}
              </span>
            </div>
          </motion.div>

          <div className="grid lg:grid-cols-2 gap-8 items-start">
            {/* Portal Features */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-xl h-full">
                <CardContent className="p-6 md:p-8">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
                      <ChefHat className="h-6 w-6 text-blue-600" />
                    </div>
                    <h2 className="text-xl md:text-2xl font-bold mb-2">Your Chef Portal</h2>
                    <p className="text-gray-600">
                      This portal is your gateway to joining the Local Cooks platform. Here's what you can do:
                    </p>
                  </div>

                  <div className="space-y-4 text-left">
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <CheckCircle className="h-3 w-3 text-green-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Submit Your Application</h4>
                        <p className="text-sm text-gray-600">Complete your chef profile and start the application process</p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <CheckCircle className="h-3 w-3 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Track Application Status</h4>
                        <p className="text-sm text-gray-600">Monitor your progress through our review process</p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <CheckCircle className="h-3 w-3 text-purple-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Upload Required Documents</h4>
                        <p className="text-sm text-gray-600">Securely submit certifications and required documentation</p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <CheckCircle className="h-3 w-3 text-orange-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Complete Training Modules</h4>
                        <p className="text-sm text-gray-600">Access learning materials for food safety and platform guidelines</p>
                      </div>
                    </div>
                    <div className="flex items-start">
                      <div className="flex-shrink-0 w-6 h-6 bg-pink-100 rounded-full flex items-center justify-center mr-3 mt-1">
                        <CheckCircle className="h-3 w-3 text-pink-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">Get Approval & Launch</h4>
                        <p className="text-sm text-gray-600">Receive approval and start your journey with Local Cooks</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* CTA Section */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <Card className="bg-gradient-to-br from-primary to-primary/90 border-0 shadow-2xl h-full">
                <CardContent className="p-6 md:p-8 text-white flex flex-col justify-center h-full">
                  <div className="text-center">
                    <h2 className="text-xl md:text-2xl font-bold mb-4">Ready to Start Your Culinary Journey?</h2>
                    <p className="text-base mb-6 text-white/90">
                      Join our growing community of talented chefs and take the first step toward sharing your culinary passion with food lovers in your area.
                    </p>
                    
                    <Button 
                      onClick={handleComplete}
                      disabled={isCompleting}
                      size="lg"
                      className="bg-white text-primary hover:bg-gray-50 font-bold py-4 px-8 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 text-lg w-full sm:w-auto"
                    >
                      {isCompleting ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent mr-2"></div>
                          Setting up your account...
                        </>
                      ) : (
                        <>
                          Enter Your Chef Portal
                          <ArrowRight className="ml-2 h-5 w-5" />
                        </>
                      )}
                    </Button>

                    <p className="text-xs text-white/70 mt-4">
                      Takes less than 2 minutes to get started • No commitment required
                    </p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
} 