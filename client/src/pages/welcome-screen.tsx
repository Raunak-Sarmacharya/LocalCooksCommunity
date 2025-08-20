import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  ChefHat,
  Clock,
  FileText,
  GraduationCap,
  HeartHandshake,
  MapPin,
  Rocket,
  Shield,
  Truck,
  Upload
} from 'lucide-react';
import { useState } from 'react';

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

  const userName = user?.displayName || user?.email?.split('@')[0] || 'User';

  // Determine user's role(s) and customize content accordingly
  const isChef = (user as any)?.isChef || false;
  const isDeliveryPartner = (user as any)?.isDeliveryPartner || false;
  
  const getUserPortalInfo = () => {
    if (isChef && isDeliveryPartner) {
      // Dual role user
      return {
        icon: ChefHat, // Default to chef icon for dual role
        title: 'Your Local Cooks Portal',
        subtitle: 'Your gateway to both cooking and delivery opportunities',
        description: 'Join our growing community as both a talented chef and reliable delivery partner.',
        ctaText: 'Enter Your Portal'
      };
    } else if (isDeliveryPartner) {
      // Pure delivery partner
      return {
        icon: Truck,
        title: 'Your Delivery Partner Portal',
        subtitle: 'Your gateway to earning through delivery',
        description: 'Join our growing community of reliable delivery partners and start earning today.',
        ctaText: 'Enter Your Delivery Portal'
      };
    } else {
      // Chef (default) or no role yet
      return {
        icon: ChefHat,
        title: 'Your Chef Portal',
        subtitle: 'Your gateway to joining the Local Cooks community',
        description: 'Join our growing community of talented chefs and take the first step toward sharing your culinary passion.',
        ctaText: 'Enter Your Chef Portal'
      };
    }
  };

  const portalInfo = getUserPortalInfo();

  // Portal features based on user role
  const getPortalFeatures = () => {
    if (isChef && isDeliveryPartner) {
      // Dual role features
      return [
        {
          icon: <FileText className="h-4 w-4" />,
          title: "Submit Applications",
          description: "Complete both chef and delivery partner applications"
        },
        {
          icon: <BarChart3 className="h-4 w-4" />,
          title: "Track Application Status", 
          description: "Monitor progress for both your applications"
        },
        {
          icon: <Upload className="h-4 w-4" />,
          title: "Upload Required Documents",
          description: "Submit certifications and documents for both roles"
        },
        {
          icon: <GraduationCap className="h-4 w-4" />,
          title: "Complete Training",
          description: "Access learning materials for food safety and delivery best practices"
        },
        {
          icon: <HeartHandshake className="h-4 w-4" />,
          title: "Get Personalized Support",
          description: "Receive guidance from our team for both roles"
        },
        {
          icon: <Rocket className="h-4 w-4" />,
          title: "Get Approval & Launch",
          description: "Start your dual journey with Local Cooks"
        }
      ];
    } else if (isDeliveryPartner) {
      // Delivery partner features
      return [
        {
          icon: <FileText className="h-4 w-4" />,
          title: "Submit Your Application",
          description: "Complete your delivery partner profile and vehicle information"
        },
        {
          icon: <BarChart3 className="h-4 w-4" />,
          title: "Track Application Status", 
          description: "Monitor your progress through our review process"
        },
        {
          icon: <Upload className="h-4 w-4" />,
          title: "Upload Required Documents",
          description: "Submit driver's license, vehicle registration, and insurance"
        },
        {
          icon: <MapPin className="h-4 w-4" />,
          title: "Set Your Delivery Zone",
          description: "Choose your preferred delivery areas and schedule"
        },
        {
          icon: <Shield className="h-4 w-4" />,
          title: "Complete Background Check",
          description: "Ensure safety for our community through verification"
        },
        {
          icon: <Clock className="h-4 w-4" />,
          title: "Start Earning",
          description: "Begin accepting delivery requests and earning money"
        }
      ];
    } else {
      // Chef features (default)
      return [
        {
          icon: <FileText className="h-4 w-4" />,
          title: "Submit Your Application",
          description: "Complete your chef profile and start the application process"
        },
        {
          icon: <BarChart3 className="h-4 w-4" />,
          title: "Track Application Status", 
          description: "Monitor your progress through our review process"
        },
        {
          icon: <Upload className="h-4 w-4" />,
          title: "Upload Required Documents",
          description: "Securely submit certifications and required documentation"
        },
        {
          icon: <GraduationCap className="h-4 w-4" />,
          title: "Complete Training Modules",
          description: "Access learning materials for food safety and platform guidelines"
        },
        {
          icon: <HeartHandshake className="h-4 w-4" />,
          title: "Get Personalized Support",
          description: "Receive guidance from our team throughout your journey"
        },
        {
          icon: <Rocket className="h-4 w-4" />,
          title: "Get Approval & Launch",
          description: "Receive approval and start your journey with Local Cooks"
        }
      ];
    }
  };

  const portalFeatures = getPortalFeatures();

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-rose-50 flex items-center justify-center">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-32 h-32 bg-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-orange-400 rounded-full blur-3xl"></div>
      </div>

      <div className="relative px-4 py-4 w-full">
        <div className="max-w-4xl mx-auto">
          {/* Welcome Header - Ultra Compact */}
          <motion.div 
            className="text-center mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-xl md:text-2xl font-bold mb-2">
              Welcome to <span className="font-logo text-primary">Local Cooks</span>, {userName}! 🎉
            </h1>
            
            <p className="text-sm text-gray-600 mb-3 max-w-md mx-auto">
              Your application journey starts here. Let's get you onboarded!
            </p>
            
            <div className="inline-flex items-center px-2 py-1 bg-green-50 rounded-full border border-green-200">
              <CheckCircle className="h-3 w-3 text-green-600 mr-1" />
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
              <CardContent className="p-6">
                {/* Portal Header - Dynamic based on role */}
                <div className="text-center mb-6">
                  <h2 className="text-xl md:text-2xl font-bold mb-2 text-gray-900 flex items-center justify-center gap-2">
                    <portalInfo.icon className="h-6 w-6 text-primary" />
                    {portalInfo.title}
                  </h2>
                  <p className="text-gray-600 text-sm">
                    {portalInfo.subtitle}
                  </p>
                </div>

                {/* 3x2 Features Grid - Compact */}
                <div className="grid md:grid-cols-3 gap-4 mb-6">
                  {portalFeatures.map((feature, index) => (
                    <motion.div 
                      key={index}
                      className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-lg border border-gray-100 hover:shadow-md transition-all duration-300 hover:-translate-y-1"
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.3 + index * 0.05 }}
                    >
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-8 h-8 bg-gradient-to-br from-primary/10 to-primary/20 rounded-lg flex items-center justify-center mr-3">
                          {feature.icon}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 mb-1 text-xs">{feature.title}</h3>
                          <p className="text-xs text-gray-600 leading-tight">{feature.description}</p>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Integrated CTA Section - Compact */}
                <motion.div 
                  className="bg-gradient-to-br from-primary to-primary/90 rounded-xl p-6 text-center text-white"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.6 }}
                >
                  <h3 className="text-lg font-bold mb-3">Ready to Start Your Journey?</h3>
                  <p className="text-white/90 mb-4 text-sm max-w-lg mx-auto">
                    {portalInfo.description}
                  </p>
                  
                  <Button 
                    onClick={handleComplete}
                    disabled={isCompleting}
                    size="lg"
                    className="bg-white text-primary hover:bg-gray-50 font-bold py-3 px-6 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                  >
                    {isCompleting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent mr-2"></div>
                        Setting up your account...
                      </>
                    ) : (
                      <>
                        {portalInfo.ctaText}
                        <ArrowRight className="ml-2 h-4 w-4" />
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