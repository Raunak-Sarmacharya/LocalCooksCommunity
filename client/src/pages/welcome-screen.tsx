import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { 
  ArrowRight, 
  CheckCircle, 
  ChefHat,
  FileText,
  BarChart3,
  Upload,
  GraduationCap,
  HeartHandshake,
  Rocket
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

  // Portal features in 3x2 grid
  const portalFeatures = [
    {
      icon: <FileText className="h-5 w-5" />,
      title: "Submit Your Application",
      description: "Complete your chef profile and start the application process"
    },
    {
      icon: <BarChart3 className="h-5 w-5" />,
      title: "Track Application Status", 
      description: "Monitor your progress through our review process"
    },
    {
      icon: <Upload className="h-5 w-5" />,
      title: "Upload Required Documents",
      description: "Securely submit certifications and required documentation"
    },
    {
      icon: <GraduationCap className="h-5 w-5" />,
      title: "Complete Training Modules",
      description: "Access learning materials for food safety and platform guidelines"
    },
    {
      icon: <HeartHandshake className="h-5 w-5" />,
      title: "Get Personalized Support",
      description: "Receive guidance from our team throughout your journey"
    },
    {
      icon: <Rocket className="h-5 w-5" />,
      title: "Get Approval & Launch",
      description: "Receive approval and start your journey with Local Cooks"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-rose-50">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-32 h-32 bg-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-orange-400 rounded-full blur-3xl"></div>
      </div>

      <div className="relative px-4 py-6 md:py-8">
        <div className="max-w-4xl mx-auto">
          {/* Welcome Header - More Compact */}
          <motion.div 
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-4">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            
            <h1 className="text-2xl md:text-3xl font-bold mb-3">
              Welcome to <span className="font-logo text-primary">Local Cooks</span>, {userName}! 🎉
            </h1>
            
            <p className="text-sm md:text-base text-gray-600 mb-4 max-w-lg mx-auto">
              Your application journey starts here. Let's get you onboarded!
            </p>
            
            <div className="inline-flex items-center px-3 py-1.5 bg-green-50 rounded-full border border-green-200">
              <CheckCircle className="h-3 w-3 text-green-600 mr-2" />
              <span className="text-xs text-green-800 font-medium">
                {getVerificationMessage()}
              </span>
            </div>
          </motion.div>

          {/* Single Cohesive Section */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <Card className="bg-white/80 backdrop-blur-sm border-0 shadow-2xl">
              <CardContent className="p-8 md:p-10">
                {/* Portal Header */}
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-100 to-blue-200 rounded-2xl mb-4">
                    <ChefHat className="h-8 w-8 text-blue-600" />
                  </div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-3 text-gray-900">Your Chef Portal</h2>
                  <p className="text-gray-600 max-w-2xl mx-auto text-lg">
                    This portal is your gateway to joining the Local Cooks community. Here's everything you can accomplish:
                  </p>
                </div>

                {/* 3x2 Features Grid */}
                <div className="grid md:grid-cols-3 gap-6 mb-10">
                  {portalFeatures.map((feature, index) => (
                    <motion.div 
                      key={index}
                      className="bg-gradient-to-br from-gray-50 to-white p-6 rounded-xl border border-gray-100 hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                    >
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-primary/10 to-primary/20 rounded-xl flex items-center justify-center mr-4 mt-1">
                          {feature.icon}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-2 text-sm">{feature.title}</h3>
                          <p className="text-xs text-gray-600 leading-relaxed">{feature.description}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Integrated CTA Section */}
                <motion.div 
                  className="bg-gradient-to-br from-primary to-primary/90 rounded-2xl p-8 text-center text-white"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.8 }}
                >
                  <h3 className="text-xl md:text-2xl font-bold mb-4">Ready to Start Your Culinary Journey?</h3>
                  <p className="text-white/90 mb-6 max-w-xl mx-auto">
                    Join our growing community of talented chefs and take the first step toward sharing your culinary passion.
                  </p>
                  
                  <Button 
                    onClick={handleComplete}
                    disabled={isCompleting}
                    size="lg"
                    className="bg-white text-primary hover:bg-gray-50 font-bold py-4 px-8 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 text-lg"
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
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
} 