import React, { useState } from 'react';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { auth } from '@/lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle, Users, Utensils, Shield, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export default function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  const { user } = useFirebaseAuth();
  const [isCompleting, setIsCompleting] = useState(false);

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
      
      console.log("✅ Welcome screen completed, proceeding to onComplete");
      onComplete();
    } catch (error) {
      console.error('❌ Error completing welcome screen:', error);
      // Still allow them to continue even if backend call fails
      console.log("🔄 Continuing despite error...");
      onComplete();
    } finally {
      setIsCompleting(false);
    }
  };

  const features = [
    {
      icon: <Utensils className="h-6 w-6 text-orange-500" />,
      title: "Local Food Community",
      description: "Connect with local cooks and discover amazing homemade meals"
    },
    {
      icon: <Shield className="h-6 w-6 text-green-500" />,
      title: "Verified & Secure",
      description: "All cooks are verified with food safety certifications"
    },
    {
      icon: <Users className="h-6 w-6 text-blue-500" />,
      title: "Community Driven",
      description: "Join a network of passionate home cooks and food lovers"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <CardTitle className="text-2xl font-bold">
            Welcome to Local Cooks!
          </CardTitle>
          <CardDescription>
            Hi {user?.displayName || user?.email?.split('@')[0] || 'there'}! 
            Your account is verified and ready to go.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="space-y-4">
            {features.map((feature, index) => (
              <div key={index} className="flex items-start space-x-3">
                <div className="flex-shrink-0 mt-1">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{feature.title}</h3>
                  <p className="text-sm text-gray-600">{feature.description}</p>
                </div>
              </div>
            ))}
          </div>
          
          <Button 
            onClick={handleComplete}
            disabled={isCompleting}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          >
            {isCompleting ? (
              "Setting up your account..."
            ) : (
              <>
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
          
          <p className="text-xs text-gray-500 text-center">
            Since you signed in with Google, your account is automatically verified!
          </p>
        </CardContent>
      </Card>
    </div>
  );
} 