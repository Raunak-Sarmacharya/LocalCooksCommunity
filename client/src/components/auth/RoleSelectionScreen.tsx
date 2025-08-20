import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { motion } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle,
  ChefHat,
  Truck
} from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';

interface RoleSelectionScreenProps {
  onRoleSelected: (roles: { isChef: boolean; isDeliveryPartner: boolean }) => void;
}

export default function RoleSelectionScreen({ onRoleSelected }: RoleSelectionScreenProps) {
  const { user } = useFirebaseAuth();
  const [, navigate] = useLocation();
  const [selectedRoles, setSelectedRoles] = useState<{isChef: boolean; isDeliveryPartner: boolean}>({
    isChef: false,
    isDeliveryPartner: false
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRoleToggle = (role: 'chef' | 'delivery_partner') => {
    setSelectedRoles(prev => ({
      ...prev,
      isChef: role === 'chef' ? !prev.isChef : prev.isChef,
      isDeliveryPartner: role === 'delivery_partner' ? !prev.isDeliveryPartner : prev.isDeliveryPartner
    }));
  };

  const hasSelectedRoles = selectedRoles.isChef || selectedRoles.isDeliveryPartner;

  const handleContinue = async () => {
    if (!hasSelectedRoles) return;
    
    setIsSubmitting(true);
    try {
      // Get current Firebase user and token
      const currentUser = auth.currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        
        // Update user's roles in the database
        const response = await fetch('/api/firebase/user/update-roles', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(selectedRoles)
        });

        if (response.ok) {
          console.log(`✅ User roles updated:`, selectedRoles);
          onRoleSelected(selectedRoles);
        } else {
          console.error('❌ Failed to update user roles:', response.status);
          // Still continue with the role selection
          onRoleSelected(selectedRoles);
        }
      } else {
        console.warn("⚠️ No Firebase user available");
        onRoleSelected(selectedRoles);
      }
    } catch (error) {
      console.error('❌ Error updating user roles:', error);
      // Still continue with the role selection
      onRoleSelected(selectedRoles);
    } finally {
      setIsSubmitting(false);
    }
  };

  const userName = user?.displayName || user?.email?.split('@')[0] || 'Chef';

  const roles = [
    {
      id: 'chef' as const,
      title: 'Local Chef',
      description: 'Cook and sell delicious food from your kitchen',
      icon: <ChefHat className="h-8 w-8 text-orange-600" />,
      features: [
        'Submit your chef application',
        'Upload food safety certifications',
        'Complete training modules',
        'Get approved to start cooking'
      ],
      color: 'from-orange-500 to-red-500'
    },
    {
      id: 'delivery_partner' as const,
      title: 'Delivery Partner',
      description: 'Deliver food and earn money with your vehicle',
      icon: <Truck className="h-8 w-8 text-blue-600" />,
      features: [
        'Submit your delivery application',
        'Upload vehicle and license documents',
        'Complete safety training',
        'Get approved to start delivering'
      ],
      color: 'from-blue-500 to-indigo-500'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-pink-50 to-rose-50 flex items-center justify-center">
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-20 left-20 w-32 h-32 bg-primary rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-20 w-48 h-48 bg-orange-400 rounded-full blur-3xl"></div>
      </div>

      <div className="relative px-4 py-4 w-full">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <motion.div 
            className="text-center mb-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-2xl md:text-3xl font-bold mb-3">
              Welcome to <span className="font-logo text-primary">Local Cooks</span>, {userName}! 🎉
            </h1>
            
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Choose how you'd like to join our community. You can select both roles if you want to be both a chef and delivery partner.
            </p>
          </motion.div>

          {/* Role Selection Cards */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            {roles.map((role, index) => (
              <motion.div
                key={role.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 + index * 0.1 }}
              >
                <Card 
                  className={`cursor-pointer transition-all duration-300 hover:shadow-xl ${
                    (role.id === 'chef' && selectedRoles.isChef) || (role.id === 'delivery_partner' && selectedRoles.isDeliveryPartner)
                      ? 'ring-2 ring-primary ring-offset-2 scale-105' 
                      : 'hover:scale-105'
                  }`}
                  onClick={() => handleRoleToggle(role.id)}
                >
                  <CardContent className="p-6">
                    <div className="text-center mb-4">
                      <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-gray-50 to-white rounded-full border border-gray-200 mb-4">
                        {role.icon}
                      </div>
                      <h3 className="text-xl font-bold text-gray-900 mb-2">{role.title}</h3>
                      <p className="text-gray-600 text-sm">{role.description}</p>
                    </div>

                    <ul className="space-y-2 mb-4">
                      {role.features.map((feature, featureIndex) => (
                        <li key={featureIndex} className="flex items-center text-sm text-gray-600">
                          <CheckCircle className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>

                    <div className={`w-full h-2 bg-gradient-to-r ${role.color} rounded-full opacity-20`} />
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Continue Button */}
          <motion.div 
            className="text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            <Button 
              onClick={handleContinue}
              disabled={!hasSelectedRoles || isSubmitting}
              size="lg"
              className="bg-primary hover:bg-primary/90 text-white font-bold py-3 px-8 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                  Setting up your account...
                </>
              ) : (
                <>
                  Continue as {(() => {
                    if (selectedRoles.isChef && selectedRoles.isDeliveryPartner) {
                      return 'Chef & Delivery Partner';
                    } else if (selectedRoles.isChef) {
                      return 'Local Chef';
                    } else if (selectedRoles.isDeliveryPartner) {
                      return 'Delivery Partner';
                    } else {
                      return '...';
                    }
                  })()}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
