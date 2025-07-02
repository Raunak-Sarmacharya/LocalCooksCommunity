import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { AnimatePresence, motion } from "framer-motion";
import {
    Crown,
    Eye,
    Mail,
    Monitor,
    Send,
    Settings,
    Smartphone,
    Sparkles,
    Tablet,
    TestTube
} from "lucide-react";
import React, { useCallback, useState } from 'react';

// Import design components
import { EmailDesignStudio } from './email-design-system/EmailDesignStudio';

// Interface definitions matching EmailDesignStudio
interface EmailDesignData {
  id: string;
  name: string;
  template: any;
  designSystem: DesignSystemConfig;
  content: EmailContent;
  metadata: EmailMetadata;
}

interface DesignSystemConfig {
  typography: TypographyConfig;
  colors: ColorSystemConfig;
  layout: LayoutConfig;
  branding: BrandingConfig;
}

interface TypographyConfig {
  primaryFont: string;
  secondaryFont: string;
  hierarchy: {
    h1: FontSettings;
    h2: FontSettings;
    h3: FontSettings;
    body: FontSettings;
    caption: FontSettings;
  };
}

interface FontSettings {
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  letterSpacing: string;
  textTransform?: string;
}

interface ColorSystemConfig {
  primary: ColorPalette;
  secondary: ColorPalette;
  accent: ColorPalette;
  neutral: ColorPalette;
  semantic: SemanticColors;
  gradients: GradientCollection;
}

interface ColorPalette {
  main: string;
  light: string;
  dark: string;
  contrast: string;
}

interface SemanticColors {
  success: string;
  warning: string;
  error: string;
  info: string;
}

interface GradientCollection {
  primary: string;
  secondary: string;
  accent: string;
}

interface LayoutConfig {
  maxWidth: string;
  padding: string;
  borderRadius: string;
  gridSystem: string;
  breakpoints: {
    mobile: string;
    tablet: string;
    desktop: string;
  };
}

interface BrandingConfig {
  logoUrl: string;
  brandColors: string[];
  fontFamily: string;
  tone: string;
}

interface EmailContent {
  subject: string;
  previewText: string;
  sections: EmailSection[];
  promoCode?: string;
  customMessage?: string;
  email?: string;
}

interface EmailSection {
  id: string;
  type: string;
  content: any;
  styling: any;
}

interface EmailMetadata {
  version: string;
  lastModified: Date;
  author: string;
  tags: string[];
  performance: PerformanceMetrics;
}

interface PerformanceMetrics {
  openRate: number;
  clickRate: number;
  conversionRate: number;
}

const PromoCodeSender: React.FC = () => {
  const { toast } = useToast();
  
  // State management
  const [isAdvancedMode, setIsAdvancedMode] = useState(false);
  const [activeTab, setActiveTab] = useState('compose');
  const [isLoading, setIsLoading] = useState(false);
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [emailPreviewHtml, setEmailPreviewHtml] = useState<string>('');
  const [previewMode, setPreviewMode] = useState('desktop');
  
  // Simple mode form data
  const [formData, setFormData] = useState({
    email: '',
    promoCode: '',
    customMessage: ''
  });

  // Advanced design data - initialized with default
  const [emailDesign, setEmailDesign] = useState<EmailDesignData>({
    id: `design-${Date.now()}`,
    name: 'Local Cooks Promo Email',
    template: null,
    designSystem: {
      typography: {
        primaryFont: 'Inter',
        secondaryFont: 'Roboto',
        hierarchy: {
          h1: { fontSize: '32px', lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.02em' },
          h2: { fontSize: '24px', lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.01em' },
          h3: { fontSize: '20px', lineHeight: '1.4', fontWeight: '600', letterSpacing: '0' },
          body: { fontSize: '16px', lineHeight: '1.6', fontWeight: '400', letterSpacing: '0' },
          caption: { fontSize: '14px', lineHeight: '1.5', fontWeight: '400', letterSpacing: '0.01em' }
        }
      },
      colors: {
        primary: { main: '#F51042', light: '#FF5470', dark: '#C20D35', contrast: '#ffffff' },
        secondary: { main: '#000000', light: '#404040', dark: '#000000', contrast: '#ffffff' },
        accent: { main: '#f59e0b', light: '#fbbf24', dark: '#d97706', contrast: '#ffffff' },
        neutral: { main: '#6b7280', light: '#d1d5db', dark: '#374151', contrast: '#ffffff' },
        semantic: { success: '#16a34a', warning: '#f59e0b', error: '#dc2626', info: '#2563eb' },
        gradients: {
          primary: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
          secondary: 'linear-gradient(135deg, #000000 0%, #404040 100%)',
          accent: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)'
        }
      },
      layout: {
        maxWidth: '600px',
        padding: '24px',
        borderRadius: '12px',
        gridSystem: '12-column',
        breakpoints: { mobile: '480px', tablet: '768px', desktop: '1024px' }
      },
      branding: {
        logoUrl: '/assets/Logo_LocalCooks.png',
        brandColors: ['#F51042', '#000000'],
        fontFamily: 'Inter',
        tone: 'professional'
      }
    },
    content: {
      subject: 'Special Offer Just for You!',
      previewText: 'Exclusive promo code inside',
      sections: [],
      promoCode: '',
      customMessage: '',
      email: ''
    },
    metadata: {
      version: '1.0.0',
      lastModified: new Date(),
      author: 'Admin',
      tags: ['promo', 'marketing'],
      performance: { openRate: 0, clickRate: 0, conversionRate: 0 }
    }
  });

  // Handle simple form changes
  const handleFormChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Also update advanced design content for consistency
    if (isAdvancedMode) {
      setEmailDesign(prev => ({
        ...prev,
        content: {
          ...prev.content,
          [field]: value
        }
      }));
    }
  };

  // Generate email preview
  const generateEmailPreview = useCallback(async () => {
    try {
      const designData = isAdvancedMode ? emailDesign : {
        ...emailDesign,
        content: {
          ...emailDesign.content,
          email: formData.email,
          promoCode: formData.promoCode,
          customMessage: formData.customMessage
        }
      };

      const response = await fetch('/api/preview-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: designData.content.email,
          promoCode: designData.content.promoCode,
          customMessage: designData.content.customMessage,
          designSystem: designData.designSystem,
          isPremium: isAdvancedMode,
          sections: designData.content.sections || []
        }),
      });

      if (response.ok) {
        const htmlContent = await response.text();
        setEmailPreviewHtml(htmlContent);
      } else {
        throw new Error('Failed to generate preview');
      }
    } catch (error) {
      console.error('Preview generation error:', error);
      setEmailPreviewHtml(`
        <div style="padding: 20px; text-align: center; font-family: Arial, sans-serif;">
          <h3 style="color: #dc2626;">Preview Error</h3>
          <p style="color: #6b7280;">Unable to generate email preview. Please check your content.</p>
        </div>
      `);
    }
  }, [isAdvancedMode, emailDesign, formData]);

  // Update preview when content changes
  React.useEffect(() => {
    if (activeTab === 'preview') {
      generateEmailPreview();
    }
  }, [activeTab, generateEmailPreview]);

  // Handle advanced email design update
  const handleEmailDesignUpdate = useCallback((updatedDesign: EmailDesignData) => {
    setEmailDesign(updatedDesign);
    
    // Sync with simple form for consistency
    setFormData({
      email: updatedDesign.content.email || '',
      promoCode: updatedDesign.content.promoCode || '',
      customMessage: updatedDesign.content.customMessage || ''
    });
  }, []);

  // Send actual email
  const sendEmail = async () => {
    const currentData = isAdvancedMode ? emailDesign.content : formData;
    
    if (!currentData.email || !currentData.promoCode || !currentData.customMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in email, promo code, and custom message",
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
          email: currentData.email,
          promoCode: currentData.promoCode,
          customMessage: currentData.customMessage,
          designSystem: isAdvancedMode ? emailDesign.designSystem : undefined,
          isPremium: isAdvancedMode,
          sections: isAdvancedMode ? emailDesign.content.sections : []
        }),
      });

      if (response.ok) {
        toast({
          title: "🎉 Email Sent Successfully!",
          description: `Promo email with code ${currentData.promoCode} sent to ${currentData.email}`,
        });
        
        // Clear form after successful send
        if (!isAdvancedMode) {
          setFormData({ email: '', promoCode: '', customMessage: '' });
        }
      } else {
        const error = await response.text();
        throw new Error(error);
      }
    } catch (error) {
      toast({
        title: "Send Failed",
        description: error instanceof Error ? error.message : "Failed to send email",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Send test email
  const sendTestEmail = async () => {
    const currentData = isAdvancedMode ? emailDesign.content : formData;
    
    if (!currentData.promoCode || !currentData.customMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in promo code and custom message",
        variant: "destructive"
      });
      return;
    }

    setIsTestLoading(true);
    
    try {
      const response = await fetch('/api/test-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promoCode: currentData.promoCode,
          customMessage: currentData.customMessage,
          designSystem: isAdvancedMode ? emailDesign.designSystem : undefined,
          isPremium: isAdvancedMode,
          sections: isAdvancedMode ? emailDesign.content.sections : []
        }),
      });

      if (response.ok) {
        toast({
          title: "🧪 Test Email Sent!",
          description: "Check your admin email for the test promo email",
        });
      } else {
        const error = await response.text();
        throw new Error(error);
      }
    } catch (error) {
      toast({
        title: "Test Failed",
        description: error instanceof Error ? error.message : "Failed to send test email",
        variant: "destructive"
      });
    } finally {
      setIsTestLoading(false);
    }
  };

  // Preview dimensions based on device
  const getPreviewDimensions = () => {
    switch (previewMode) {
      case 'mobile': return { width: '320px', height: '600px' };
      case 'tablet': return { width: '500px', height: '700px' };
      default: return { width: '600px', height: '800px' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Mode Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-gradient-to-br from-green-100 to-emerald-100 rounded-lg">
                <Mail className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-xl text-gray-900">Promo Code Email Sender</CardTitle>
                <CardDescription>Send personalized promo codes to customers</CardDescription>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <Label htmlFor="advanced-mode" className="text-sm font-medium text-gray-700">
                  Simple Mode
                </Label>
                <Switch
                  id="advanced-mode"
                  checked={isAdvancedMode}
                  onCheckedChange={setIsAdvancedMode}
                />
                        <Label htmlFor="advanced-mode" className="text-sm font-medium text-gray-700 flex items-center">
          <Crown className="h-4 w-4 mr-1 text-yellow-600" />
          Advanced Studio
                </Label>
              </div>
              
              {isAdvancedMode && (
                <Badge variant="outline" className="bg-gradient-to-r from-yellow-50 to-amber-50 text-yellow-800 border-yellow-200 font-medium">
                  <Sparkles className="h-3 w-3 mr-1" />
                  Advanced Studio
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      <AnimatePresence mode="wait">
        {isAdvancedMode ? (
          <motion.div
            key="advanced"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Advanced Email Design Studio */}
            <EmailDesignStudio
              onEmailGenerated={handleEmailDesignUpdate}
              initialDesign={emailDesign}
            />
          </motion.div>
        ) : (
          <motion.div
            key="simple"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Simple Mode Interface */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-2 bg-white shadow-sm">
                <TabsTrigger value="compose" className="flex items-center">
                  <Settings className="h-4 w-4 mr-2" />
                  Compose
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center">
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </TabsTrigger>
              </TabsList>

              <TabsContent value="compose" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center text-gray-900">
                      <Mail className="h-5 w-5 mr-2" />
                      Email Details
                    </CardTitle>
                    <CardDescription>
                      Enter the customer email and promo details
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="email" className="text-sm font-medium text-gray-700">Customer Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="customer@example.com"
                        value={formData.email}
                        onChange={(e) => handleFormChange('email', e.target.value)}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="promoCode" className="text-sm font-medium text-gray-700">Promo Code</Label>
                      <Input
                        id="promoCode"
                        placeholder="SAVE20"
                        value={formData.promoCode}
                        onChange={(e) => handleFormChange('promoCode', e.target.value.toUpperCase())}
                        className="mt-1"
                      />
                    </div>

                    <div>
                      <Label htmlFor="customMessage" className="text-sm font-medium text-gray-700">
                        Custom Message ({formData.customMessage.length}/1000)
                      </Label>
                      <Textarea
                        id="customMessage"
                        placeholder="Write your personalized message to the customer..."
                        value={formData.customMessage}
                        onChange={(e) => handleFormChange('customMessage', e.target.value)}
                        maxLength={1000}
                        rows={4}
                        className="mt-1"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        This message will appear prominently in your email template
                      </p>
                    </div>

                    <div className="flex space-x-3 pt-4">
                      <Button
                        onClick={sendTestEmail}
                        disabled={isTestLoading || !formData.promoCode || !formData.customMessage}
                        variant="outline"
                        className="flex-1"
                      >
                        {isTestLoading ? (
                          <>
                            <TestTube className="h-4 w-4 mr-2 animate-spin" />
                            Sending Test...
                          </>
                        ) : (
                          <>
                            <TestTube className="h-4 w-4 mr-2" />
                            Send Test Email
                          </>
                        )}
                      </Button>

                      <Button
                        onClick={sendEmail}
                        disabled={isLoading || !formData.email || !formData.promoCode || !formData.customMessage}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        {isLoading ? (
                          <>
                            <Send className="h-4 w-4 mr-2 animate-spin" />
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
              </TabsContent>

              <TabsContent value="preview" className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg flex items-center text-gray-900">
                          <Eye className="h-5 w-5 mr-2" />
                          Email Preview
                        </CardTitle>
                        <CardDescription>
                          Live preview of your promo email
                        </CardDescription>
                      </div>
                      
                      <div className="flex items-center space-x-1 bg-gray-100 rounded-lg p-1">
                        <Button
                          variant={previewMode === 'desktop' ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setPreviewMode('desktop')}
                          className="h-8 px-3"
                        >
                          <Monitor className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={previewMode === 'tablet' ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setPreviewMode('tablet')}
                          className="h-8 px-3"
                        >
                          <Tablet className="h-4 w-4" />
                        </Button>
                        <Button
                          variant={previewMode === 'mobile' ? "default" : "ghost"}
                          size="sm"
                          onClick={() => setPreviewMode('mobile')}
                          className="h-8 px-3"
                        >
                          <Smartphone className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex justify-center bg-gray-100 p-8 rounded-lg">
                      <div 
                        className="bg-white shadow-lg rounded-lg overflow-hidden transition-all duration-300"
                        style={getPreviewDimensions()}
                      >
                        {emailPreviewHtml ? (
                          <div 
                            className="h-full overflow-y-auto"
                            dangerouslySetInnerHTML={{ __html: emailPreviewHtml }}
                          />
                        ) : (
                          <div className="h-full flex items-center justify-center p-8 text-center">
                            <div>
                              <Eye className="h-12 w-12 mx-auto text-gray-400 mb-3" />
                              <h3 className="text-lg font-medium text-gray-900 mb-2">Email Preview</h3>
                              <p className="text-gray-600">
                                Fill in the email details to see a preview
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </AnimatePresence>

              {/* Action Buttons for Advanced Mode */}
        {isAdvancedMode && (
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Ready to Send?</h3>
                <p className="text-sm text-gray-600">
                  Your advanced email design is ready. Send a test or deliver to customer.
                </p>
              </div>
              
              <div className="flex space-x-3">
                <Button
                  onClick={sendTestEmail}
                  disabled={isTestLoading || !emailDesign.content.promoCode || !emailDesign.content.customMessage}
                  variant="outline"
                >
                  {isTestLoading ? (
                    <>
                      <TestTube className="h-4 w-4 mr-2 animate-spin" />
                      Sending Test...
                    </>
                  ) : (
                    <>
                      <TestTube className="h-4 w-4 mr-2" />
                      Send Test
                    </>
                  )}
                </Button>

                <Button
                  onClick={sendEmail}
                  disabled={isLoading || !emailDesign.content.email || !emailDesign.content.promoCode || !emailDesign.content.customMessage}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                >
                  {isLoading ? (
                    <>
                      <Send className="h-4 w-4 mr-2 animate-spin" />
                      Sending Advanced Email...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" />
                      Send Advanced Email
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default PromoCodeSender; 