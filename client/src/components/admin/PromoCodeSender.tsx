import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AnimatePresence, motion } from "framer-motion";
import {
    CheckCircle,
    Crown,
    Loader2,
    Rocket,
    Send,
    Settings,
    Sparkles,
    Star,
    TestTube
} from "lucide-react";
import React, { useState } from 'react';

// Import our ultra-premium email design system
import { EmailDesignStudio } from './email-design-system/EmailDesignStudio';

interface PromoEmailData {
  email: string;
  promoCode: string;
  customMessage: string;
  designSystem?: any;
}

interface EmailDesignData {
  id: string;
  name: string;
  template: any;
  designSystem: any;
  content: any;
  metadata: any;
}

export const PromoCodeSender: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('premium');
  const [isLoading, setIsLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [designMode, setDesignMode] = useState<'premium' | 'simple'>('premium');
  
  // Premium Email Design State
  const [emailDesign, setEmailDesign] = useState<EmailDesignData | null>(null);
  
  // Simple Form State (Fallback)
  const [simpleFormData, setSimpleFormData] = useState<PromoEmailData>({
    email: '',
    promoCode: '',
    customMessage: ''
  });

  const handlePremiumEmailGenerated = (designData: EmailDesignData) => {
    setEmailDesign(designData);
    toast({
      title: "🎨 Premium Email Design Ready!",
      description: "Your enterprise-level email has been designed. Ready to send!",
    });
  };

  const handleSendPremiumEmail = async () => {
    if (!emailDesign) {
      toast({
        title: "No Design Selected",
        description: "Please create an email design first.",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailDesign.content.email || simpleFormData.email,
          promoCode: emailDesign.content.promoCode,
          customMessage: emailDesign.content.customMessage,
          designSystem: emailDesign.designSystem
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "🚀 Premium Email Sent!",
          description: `Enterprise email successfully delivered to ${result.email}`,
        });
        
        // Reset form
        setEmailDesign(null);
      } else {
        throw new Error(result.message || 'Failed to send email');
      }
    } catch (error: any) {
      toast({
        title: "Send Failed",
        description: error.message || "Failed to send premium email",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestPremiumEmail = async () => {
    if (!emailDesign) {
      toast({
        title: "No Design Selected",
        description: "Please create an email design first.",
        variant: "destructive"
      });
      return;
    }

    setTestLoading(true);
    
    try {
      const response = await fetch('/api/test-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@test.com',
          promoCode: emailDesign.content.promoCode || 'TEST20',
          customMessage: emailDesign.content.customMessage || 'This is a premium test email',
          designSystem: emailDesign.designSystem
        }),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "✨ Test Email Sent!",
          description: "Premium test email delivered successfully",
        });
      } else {
        throw new Error(result.message || 'Failed to send test email');
      }
    } catch (error: any) {
      toast({
        title: "Test Failed",
        description: error.message || "Failed to send test email",
        variant: "destructive"
      });
    } finally {
      setTestLoading(false);
    }
  };

  // Simple form handlers (fallback)
  const handleSimpleFormSubmit = async () => {
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simpleFormData),
      });

      const result = await response.json();

      if (response.ok) {
        toast({
          title: "Email Sent!",
          description: `Promo email sent to ${result.email}`,
        });
        
        setSimpleFormData({ email: '', promoCode: '', customMessage: '' });
      } else {
        throw new Error(result.message || 'Failed to send email');
      }
    } catch (error: any) {
      toast({
        title: "Send Failed",
        description: error.message || "Failed to send email",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      {/* Ultra-Premium Header */}
      <div className="border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="p-3 bg-gradient-to-br from-purple-100 to-blue-100 rounded-xl">
                  <Crown className="h-8 w-8 text-purple-600" />
                </div>
                <div>
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-emerald-600 bg-clip-text text-transparent">
                    Enterprise Email Studio
                  </h1>
                  <p className="text-slate-600 dark:text-slate-400">
                    Million-dollar company level email customization
                  </p>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Badge variant="outline" className="bg-gradient-to-r from-yellow-100 to-amber-100 text-yellow-800 border-yellow-200">
                  <Star className="h-3 w-3 mr-1" />
                  Ultra Premium
                </Badge>
                <Badge variant="outline" className="bg-gradient-to-r from-purple-100 to-blue-100 text-purple-800 border-purple-200">
                  <Rocket className="h-3 w-3 mr-1" />
                  Enterprise Ready
                </Badge>
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {/* Design Mode Toggle */}
              <div className="flex items-center space-x-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                <Button
                  variant={designMode === 'premium' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setDesignMode('premium')}
                  className="h-8 px-3"
                >
                  <Crown className="h-4 w-4 mr-2" />
                  Premium Studio
                </Button>
                <Button
                  variant={designMode === 'simple' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setDesignMode('simple')}
                  className="h-8 px-3"
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Simple Mode
                </Button>
              </div>

              {/* Action Buttons for Premium Mode */}
              {designMode === 'premium' && emailDesign && (
                <div className="flex items-center space-x-2">
                  <Button 
                    onClick={handleTestPremiumEmail}
                    disabled={testLoading}
                    variant="outline"
                    size="sm"
                  >
                    {testLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <TestTube className="h-4 w-4 mr-2" />
                    )}
                    Test Premium
                  </Button>
                  <Button 
                    onClick={handleSendPremiumEmail}
                    disabled={isLoading}
                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4 mr-2" />
                    )}
                    Send Enterprise Email
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {designMode === 'premium' ? (
            <motion.div
              key="premium"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Premium Design Studio */}
              <Card className="border-2 border-gradient-to-r from-purple-200 to-blue-200 shadow-2xl">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-blue-50 border-b">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <Sparkles className="h-6 w-6 text-purple-600" />
                      <div>
                        <CardTitle className="text-2xl">Ultra-Premium Email Design Studio</CardTitle>
                        <CardDescription className="text-lg">
                          Create enterprise-level emails with advanced customization
                        </CardDescription>
                      </div>
                    </div>
                    
                    {emailDesign && (
                      <Badge variant="default" className="bg-gradient-to-r from-green-600 to-emerald-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Design Ready
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                
                <CardContent className="p-0">
                  <EmailDesignStudio 
                    onEmailGenerated={handlePremiumEmailGenerated}
                    initialDesign={emailDesign || undefined}
                  />
                </CardContent>
              </Card>
            </motion.div>
          ) : (
            <motion.div
              key="simple"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Simple Mode Fallback */}
              <Card className="max-w-2xl mx-auto">
                <CardHeader>
                  <div className="flex items-center space-x-3">
                    <Settings className="h-6 w-6 text-slate-600" />
                    <div>
                      <CardTitle>Simple Promo Email Sender</CardTitle>
                      <CardDescription>
                        Quick and easy email sending
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="email">Recipient Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="customer@example.com"
                        value={simpleFormData.email}
                        onChange={(e) => setSimpleFormData(prev => ({ ...prev, email: e.target.value }))}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="promoCode">Promo Code</Label>
                      <Input
                        id="promoCode"
                        placeholder="SAVE20"
                        value={simpleFormData.promoCode}
                        onChange={(e) => setSimpleFormData(prev => ({ ...prev, promoCode: e.target.value }))}
                        required
                      />
                    </div>

                    <div>
                      <Label htmlFor="customMessage">Custom Message</Label>
                      <Textarea
                        id="customMessage"
                        placeholder="Thank you for being an amazing customer! Here's a special offer just for you..."
                        rows={4}
                        value={simpleFormData.customMessage}
                        onChange={(e) => setSimpleFormData(prev => ({ ...prev, customMessage: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex space-x-3">
                    <Button 
                      onClick={handleSimpleFormSubmit}
                      disabled={isLoading || !simpleFormData.email || !simpleFormData.promoCode || !simpleFormData.customMessage}
                      className="flex-1"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4 mr-2" />
                          Send Email
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Feature Comparison */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mt-12"
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-center">Choose Your Email Experience</CardTitle>
              <CardDescription className="text-center">
                From simple sending to enterprise-level design control
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-6 border rounded-lg bg-gradient-to-br from-purple-50 to-blue-50">
                  <div className="flex items-center space-x-3 mb-4">
                    <Crown className="h-8 w-8 text-purple-600" />
                    <div>
                      <h3 className="text-xl font-bold">Ultra-Premium Studio</h3>
                      <Badge variant="outline" className="mt-1">Enterprise Level</Badge>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Visual email designer with drag-drop</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Advanced color system with brand palettes</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Enterprise typography controls</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Multi-device preview modes</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>AI-powered design suggestions</span>
                    </li>
                  </ul>
                </div>

                <div className="p-6 border rounded-lg">
                  <div className="flex items-center space-x-3 mb-4">
                    <Settings className="h-8 w-8 text-slate-600" />
                    <div>
                      <h3 className="text-xl font-bold">Simple Mode</h3>
                      <Badge variant="outline" className="mt-1">Quick & Easy</Badge>
                    </div>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Quick form-based email creation</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Standard Local Cooks branding</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Custom message support</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span>Fast email delivery</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}; 