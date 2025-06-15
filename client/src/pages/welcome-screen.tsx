import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { 
  ArrowRight, 
  CheckCircle, 
  Shield, 
  Users, 
  Utensils, 
  TrendingUp,
  Calendar,
  CreditCard,
  Camera,
  Megaphone,
  Award,
  Heart,
  Star,
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

  // Core platform features for cooks
  const platformFeatures = [
    {
      icon: <Utensils className="h-5 w-5" />,
      title: "Showcase Your Culinary Skills",
      description: "Upload your best dishes and build your personal brand as a chef"
    },
    {
      icon: <Users className="h-5 w-5" />,
      title: "Connect with Local Community",
      description: "Join a network of passionate food lovers in your area"
    },
    {
      icon: <Shield className="h-5 w-5" />,
      title: "Verified & Trusted Platform",
      description: "All cooks are verified with food safety certifications for trust"
    }
  ];

  // Benefits for early adopters
  const earlyBenefits = [
    {
      icon: <Award className="h-4 w-4 text-amber-500" />,
      text: "Reduced platform fees during trial phase"
    },
    {
      icon: <Star className="h-4 w-4 text-blue-500" />,
      text: "Priority placement in our marketplace"
    },
    {
      icon: <Camera className="h-4 w-4 text-green-500" />,
      text: "Free professional food photography"
    },
    {
      icon: <Megaphone className="h-4 w-4 text-purple-500" />,
      text: "Personalized marketing support"
    }
  ];

  // Main value propositions
  const valueProps = [
    {
      icon: <CreditCard className="h-8 w-8 text-green-500" />,
      title: "Weekly Payments",
      description: "Get paid directly every week"
    },
    {
      icon: <Calendar className="h-8 w-8 text-blue-500" />,
      title: "Flexible Schedule",
      description: "Work when you want to work"
    },
    {
      icon: <TrendingUp className="h-8 w-8 text-purple-500" />,
      title: "Grow Your Business",
      description: "Build a sustainable income stream"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-rose-50">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-20 w-32 h-32 bg-primary rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-20 w-48 h-48 bg-orange-400 rounded-full blur-3xl"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-pink-300 rounded-full blur-3xl"></div>
        </div>

        <div className="relative px-4 py-8 md:py-12">
          <div className="max-w-4xl mx-auto">
            {/* Welcome Header */}
            <motion.div 
              className="text-center mb-8 md:mb-12"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-6">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              
              <h1 className="text-3xl md:text-5xl font-bold mb-4">
                Welcome to <span className="font-logo text-primary">Local Cooks</span>, {userName}! 🎉
              </h1>
              
              <p className="text-lg md:text-xl text-gray-600 mb-4 max-w-2xl mx-auto">
                Your culinary journey starts here. Join our community of talented chefs and 
                turn your passion for cooking into a thriving business.
              </p>
              
              <div className="inline-flex items-center px-4 py-2 bg-green-50 rounded-full border border-green-200">
                <CheckCircle className="h-4 w-4 text-green-600 mr-2" />
                <span className="text-sm text-green-800 font-medium">
                  {getVerificationMessage()}
                </span>
              </div>
            </motion.div>

            {/* What is Local Cooks */}
            <motion.div 
              className="mb-8 md:mb-12"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
            >
              <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-xl">
                <CardContent className="p-6 md:p-8">
                  <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-4">
                      <Heart className="h-6 w-6 text-primary" />
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold mb-4">What is Local Cooks?</h2>
                    <p className="text-lg text-gray-600 max-w-3xl mx-auto leading-relaxed">
                      We're a community-driven platform that connects talented home chefs with food lovers in their local area. 
                      <strong className="text-gray-800"> Focus on what you do best—cooking—while we handle orders, delivery, marketing, and customer service.</strong>
                    </p>
                  </div>

                  <div className="grid md:grid-cols-3 gap-6 mb-8">
                    {platformFeatures.map((feature, index) => (
                      <motion.div 
                        key={index}
                        className="text-center p-4"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 + index * 0.1 }}
                      >
                        <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-100 rounded-xl mb-3">
                          {feature.icon}
                        </div>
                        <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                        <p className="text-sm text-gray-600">{feature.description}</p>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Value Propositions */}
            <motion.div 
              className="mb-8 md:mb-12"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
            >
              <div className="text-center mb-8">
                <h2 className="text-2xl md:text-3xl font-bold mb-4">Why Chefs Choose Us</h2>
                <p className="text-gray-600 max-w-2xl mx-auto">
                  Build a sustainable cooking business with the freedom and support you deserve
                </p>
              </div>

              <div className="grid md:grid-cols-3 gap-6 mb-8">
                {valueProps.map((prop, index) => (
                  <motion.div
                    key={index}
                    className="bg-white/70 backdrop-blur-sm rounded-xl p-6 text-center shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.5 + index * 0.1 }}
                  >
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-50 rounded-2xl mb-4">
                      {prop.icon}
                    </div>
                    <h3 className="font-bold text-lg mb-2">{prop.title}</h3>
                    <p className="text-gray-600">{prop.description}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Early Bird Benefits */}
            <motion.div 
              className="mb-8 md:mb-12"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.6 }}
            >
              <Card className="bg-gradient-to-br from-primary/5 to-orange-50 border-primary/20 shadow-xl">
                <CardContent className="p-6 md:p-8">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-full mb-4">
                      <Award className="h-6 w-6 text-primary" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">🚀 Early Bird Advantages</h2>
                    <p className="text-gray-600">
                      Join during our trial phase and get exclusive benefits that won't be available later
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {earlyBenefits.map((benefit, index) => (
                      <motion.div 
                        key={index}
                        className="flex items-center p-3 bg-white/70 rounded-lg"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.5, delay: 0.7 + index * 0.1 }}
                      >
                        <div className="flex-shrink-0 w-8 h-8 bg-white rounded-full flex items-center justify-center mr-3">
                          {benefit.icon}
                        </div>
                        <span className="text-sm font-medium text-gray-800">{benefit.text}</span>
                      </motion.div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* Portal Features */}
            <motion.div 
              className="mb-8 md:mb-12"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.8 }}
            >
              <Card className="bg-white/70 backdrop-blur-sm border-0 shadow-xl">
                <CardContent className="p-6 md:p-8">
                  <div className="text-center mb-6">
                    <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
                      <ChefHat className="h-6 w-6 text-blue-600" />
                    </div>
                    <h2 className="text-2xl font-bold mb-2">Your Chef Portal</h2>
                    <p className="text-gray-600 max-w-2xl mx-auto">
                      This portal is your command center for building and managing your cooking business. Here's what you can do:
                    </p>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6 text-left">
                    <div className="space-y-4">
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-green-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Submit Your Application</h4>
                          <p className="text-sm text-gray-600">Complete your chef profile and certification process</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-blue-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Track Application Status</h4>
                          <p className="text-sm text-gray-600">Monitor your progress through our verification process</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-purple-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-purple-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Upload Documents</h4>
                          <p className="text-sm text-gray-600">Securely submit required certifications and licenses</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-orange-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-orange-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Complete Training</h4>
                          <p className="text-sm text-gray-600">Access microlearning modules for food safety and business skills</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-pink-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-pink-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Get Personalized Support</h4>
                          <p className="text-sm text-gray-600">Receive guidance from our team throughout your journey</p>
                        </div>
                      </div>
                      <div className="flex items-start">
                        <div className="flex-shrink-0 w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center mr-3 mt-1">
                          <CheckCircle className="h-3 w-3 text-indigo-600" />
                        </div>
                        <div>
                          <h4 className="font-medium text-gray-900">Launch Your Business</h4>
                          <p className="text-sm text-gray-600">Start selling your delicious creations to local customers</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            {/* CTA Section */}
            <motion.div 
              className="text-center"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 1.0 }}
            >
              <Card className="bg-gradient-to-br from-primary to-primary/90 border-0 shadow-2xl">
                <CardContent className="p-6 md:p-8 text-white">
                  <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to Start Your Culinary Journey?</h2>
                  <p className="text-lg mb-6 text-white/90 max-w-2xl mx-auto">
                    Join hundreds of talented chefs who are already building successful businesses with Local Cooks. 
                    Your community is waiting to taste what you create!
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

                  <p className="text-xs text-white/70 mt-4">
                    Takes less than 2 minutes to get started • No commitment required
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
} 