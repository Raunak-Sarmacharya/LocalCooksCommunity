import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { 
  Mail, 
  Send, 
  Save, 
  Palette, 
  Type, 
  Square, 
  Plus, 
  Eye, 
  Settings, 
  Copy, 
  Edit3,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Link,
  Image,
  Trash2,
  Move,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Target,
  Zap,
  Download,
  Upload,
  RefreshCw,
  Check,
  X,
  Info,
  AlertCircle,
  HelpCircle
} from 'lucide-react'
import { useToast } from "@/hooks/use-toast";

interface EmailDesignStudioProps {
  onEmailGenerated: (emailData: EmailDesignData) => void;
  initialDesign?: EmailDesignData;
}

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
  sections: { [key: string]: EmailSection };
  promoCode?: string;
  promoCodeLabel?: string;
  message?: string;
  buttonText?: string;
  orderUrl?: string;
  customerName?: string;
  email?: string;
  recipientType?: string;
  promoCodeStyling?: {
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    fontSize?: string;
    fontWeight?: string;
    labelColor?: string;
    labelFontSize?: string;
    labelFontWeight?: string;
  };
  header?: {
    title?: string;
    subtitle?: string;
    styling?: {
      backgroundColor?: string;
      titleColor?: string;
      subtitleColor?: string;
      titleFontSize?: string;
      subtitleFontSize?: string;
      padding?: string;
      borderRadius?: string;
      textAlign?: string;
    };
  };
}

interface EmailSection {
  id: string;
  type: string;
  text?: string;
  url?: string;
  styling?: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    fontStyle?: string;
    textAlign?: string;
    backgroundColor?: string;
    padding?: string;
    borderRadius?: string;
    alignment?: string;
  };
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

export const EmailDesignStudio: React.FC<EmailDesignStudioProps> = ({
  onEmailGenerated,
  initialDesign
}) => {
  const { toast } = useToast();
  const [currentDesign, setCurrentDesign] = useState<EmailDesignData>(
    initialDesign || createDefaultDesign()
  );
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isTestingEmail, setIsTestingEmail] = useState(false);

  // Create default design configuration
  function createDefaultDesign(): EmailDesignData {
    return {
      id: `design-${Date.now()}`,
      name: 'Email Campaign Template',
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
        subject: 'Important Update from Local Cooks',
        previewText: 'We have exciting news to share with you',
        sections: {
          'custom-message': {
            id: 'custom-message-section',
            type: 'custom-message',
            text: 'We\'re excited to share this special offer with you! Use the code below to enjoy exclusive savings on your next order.',
            styling: {
              fontSize: '16px',
              color: '#374151',
              fontWeight: 'normal',
              textAlign: 'left'
            }
          }
        },
        promoCode: 'WELCOME20',
        promoCodeLabel: '🎁 Special Offer Code',
        message: 'We\'re excited to share this special offer with you! Use the code below to enjoy exclusive savings on your next order.',
        buttonText: '🌟 Get Started',
        orderUrl: 'https://localcooks.com',
        customerName: 'Valued Customer',
        email: '',
        recipientType: 'customer',
        promoCodeStyling: {
          backgroundColor: '#f3f4f6',
          borderColor: '#9ca3af',
          textColor: '#1f2937',
          fontSize: '24px',
          fontWeight: 'bold',
          labelColor: '#374151',
          labelFontSize: '16px',
          labelFontWeight: '600'
        },
        header: {
          title: 'Local Cooks',
          subtitle: 'Premium Quality Food',
          styling: {
            backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
            titleColor: '#ffffff',
            subtitleColor: '#ffffff',
            titleFontSize: '32px',
            subtitleFontSize: '18px',
            padding: '24px',
            borderRadius: '0px',
            textAlign: 'center'
          }
        }
      },
      metadata: {
        version: '1.0',
        lastModified: new Date(),
        author: 'Admin',
        tags: ['campaign', 'communication'],
        performance: { openRate: 0, clickRate: 0, conversionRate: 0 }
      }
    };
  }

  // Handle content updates
  const handleContentUpdate = (content: Partial<EmailContent>) => {
    setCurrentDesign(prev => ({
      ...prev,
      content: { ...prev.content, ...content }
    }));
    
    // Notify parent component
    onEmailGenerated({
      ...currentDesign,
      content: { ...currentDesign.content, ...content }
    });
  };

  // Add new section
  const addSection = (type: string) => {
    const newSection: EmailSection = {
      id: `section-${Date.now()}`,
      type,
      text: type === 'text' ? 'New text content' : type === 'button' ? 'Button Text' : '',
      styling: {
        backgroundColor: type === 'button' ? currentDesign.designSystem.colors.primary.main : 'transparent',
        color: type === 'button' ? '#ffffff' : '#374151',
        fontSize: '16px',
        fontWeight: type === 'button' ? '600' : '400',
        padding: type === 'button' ? '12px 24px' : '8px 0',
        borderRadius: '8px',
        textAlign: 'left'
      }
    };

    handleContentUpdate({
      sections: { ...currentDesign.content.sections, [newSection.id]: newSection }
    });
    setSelectedElement(newSection.id);
  };

  // Remove section
  const removeSection = (sectionId: string) => {
    const updatedSections = { ...currentDesign.content.sections };
    delete updatedSections[sectionId];
    handleContentUpdate({ sections: updatedSections });
    if (selectedElement === sectionId) {
      setSelectedElement(null);
    }
  };

  // Update element styling
  const updateElementStyling = (elementId: string, property: string, value: string) => {
    if (elementId === 'email-header') {
      const headerStyling = currentDesign.content.header?.styling || {};
      handleContentUpdate({
        header: {
          ...currentDesign.content.header,
          styling: {
            ...headerStyling,
            [property]: value
          }
        }
      });
    } else if (elementId === 'greeting') {
      const greetingSection = currentDesign.content.sections.greeting;
      if (greetingSection) {
        const updatedSections = {
          ...currentDesign.content.sections,
          greeting: {
            ...greetingSection,
            styling: {
              ...greetingSection.styling,
              [property]: value
            }
          }
        };
        handleContentUpdate({ sections: updatedSections });
      } else {
        const newGreetingSection: EmailSection = {
          id: 'greeting-section',
          type: 'greeting',
          text: "Hello! 👋",
          styling: {
            fontSize: '24px',
            color: '#1f2937',
            fontWeight: '500',
            textAlign: 'left',
            [property]: value
          }
        };
        handleContentUpdate({ sections: { ...currentDesign.content.sections, greeting: newGreetingSection } });
      }
    } else if (elementId === 'custom-message') {
      const messageSection = currentDesign.content.sections['custom-message'];
      if (messageSection) {
        const updatedSections = {
          ...currentDesign.content.sections,
          'custom-message': {
            ...messageSection,
            styling: {
              ...messageSection.styling,
              [property]: value
            }
          }
        };
        handleContentUpdate({ sections: updatedSections });
      } else {
        const newCustomMessageSection: EmailSection = {
          id: 'custom-message-section',
          type: 'custom-message',
          text: currentDesign.content.message || '',
          styling: {
            fontSize: '16px',
            color: '#374151',
            fontWeight: 'normal',
            textAlign: 'left',
            [property]: value
          }
        };
        handleContentUpdate({ sections: { ...currentDesign.content.sections, 'custom-message': newCustomMessageSection } });
      }
    } else {
      const section = currentDesign.content.sections[elementId];
      if (section) {
        const updatedSections = {
          ...currentDesign.content.sections,
          [elementId]: {
            ...section,
            styling: {
              ...section.styling,
              [property]: value
            }
          }
        };
        handleContentUpdate({ sections: updatedSections });
      }
    }
  };

  // Update element content
  const updateElementContent = (elementId: string, content: string) => {
    if (elementId === 'custom-message') {
      // Ensure both message and section are updated consistently
      const customMessageSection: EmailSection = {
        id: 'custom-message-section',
        type: 'custom-message',
        text: content,
        styling: currentDesign.content.sections?.['custom-message']?.styling || {
          fontSize: '16px',
          color: '#374151',
          fontWeight: 'normal',
          textAlign: 'left'
        }
      };
      
      handleContentUpdate({ 
        message: content,
        sections: { 
          ...currentDesign.content.sections, 
          'custom-message': customMessageSection 
        }
      });
    } else if (elementId === 'promo-code') {
      handleContentUpdate({ promoCode: content });
    } else if (elementId === 'promo-code-label') {
      handleContentUpdate({ promoCodeLabel: content });
    } else if (elementId === 'customer-email') {
      handleContentUpdate({ email: content });
    } else if (elementId === 'greeting') {
      const greetingSection = currentDesign.content.sections.greeting;
      if (greetingSection) {
        const updatedSections = {
          ...currentDesign.content.sections,
          greeting: {
            ...greetingSection,
            text: content
          }
        };
        handleContentUpdate({ sections: updatedSections });
      } else {
        const newGreetingSection: EmailSection = {
          id: 'greeting-section',
          type: 'greeting',
          text: content,
          styling: {
            fontSize: '24px',
            color: '#1f2937',
            fontWeight: '500',
            textAlign: 'left'
          }
        };
        handleContentUpdate({ sections: { ...currentDesign.content.sections, greeting: newGreetingSection } });
      }
    } else if (elementId === 'order-button') {
      handleContentUpdate({ buttonText: content });
    } else {
      const section = currentDesign.content.sections[elementId];
      if (section) {
        const updatedSections = {
          ...currentDesign.content.sections,
          [elementId]: {
            ...section,
            text: content
          }
        };
        handleContentUpdate({ sections: updatedSections });
      }
    }
  };

  // Promo code container shapes
  const promoCodeShapes = [
    { id: 'ticket', name: 'Ticket Shape', style: { clipPath: 'polygon(0 0, 90% 0, 100% 50%, 90% 100%, 0 100%, 10% 50%)' } },
    { id: 'rounded', name: 'Rounded Box', style: { borderRadius: '12px' } },
    { id: 'dashed', name: 'Dashed Border', style: { border: '2px dashed #16a34a', borderRadius: '8px' } },
    { id: 'gradient', name: 'Gradient Box', style: { background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)', borderRadius: '8px' } }
  ];

  // Test email functionality
  const handleTestEmail = async () => {
    if (!currentDesign.content.email) {
      toast({
        title: "Email Required",
        description: "Please enter a test email address",
        variant: "destructive"
      });
      return;
    }

    setIsTestingEmail(true);
    try {
      const response = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: currentDesign.content.email,
          subject: currentDesign.content.subject || 'Test Email',
          previewText: currentDesign.content.previewText || 'Test preview',
          sections: currentDesign.content.sections,
          header: currentDesign.content.header,
          customDesign: currentDesign
        })
      });

      if (response.ok) {
        toast({
          title: "✅ Test Email Sent!",
          description: `Test email sent to ${currentDesign.content.email}`
        });
      } else {
        throw new Error('Failed to send test email');
      }
    } catch (error) {
      toast({
        title: "Test Failed",
        description: "Could not send test email. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsTestingEmail(false);
    }
  };

  // Send promo email
  const handleSendPromoEmail = async () => {
    if (!currentDesign.content.email) {
      toast({
        title: "Email Required",
        description: "Please enter a test email address",
        variant: "destructive"
      });
      return;
    }

    // Validate required fields before sending
    if (!currentDesign.content.promoCode) {
      toast({
        title: "Promo Code Required",
        description: "Please enter a promo code",
        variant: "destructive"
      });
      return;
    }

    if (!currentDesign.content.message || currentDesign.content.message.length < 10) {
      toast({
        title: "Custom Message Required",
        description: "Please enter a custom message (at least 10 characters)",
        variant: "destructive"
      });
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Essential for session-based admin auth
        body: JSON.stringify({
          email: currentDesign.content.email,
          promoCode: currentDesign.content.promoCode,
          promoCodeLabel: currentDesign.content.promoCodeLabel,
          message: currentDesign.content.message,
          buttonText: currentDesign.content.buttonText,
          orderUrl: currentDesign.content.orderUrl,
          promoCodeStyling: currentDesign.content.promoCodeStyling,
          designSystem: currentDesign.designSystem,
          isPremium: true,
          sections: currentDesign.content.sections,
          header: currentDesign.content.header,
          subject: currentDesign.content.subject,
          previewText: currentDesign.content.previewText,
          customDesign: currentDesign
        })
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: "✅ Promo Email Sent!",
          description: `Promo email sent to ${currentDesign.content.email}`
        });
      } else {
        // Get detailed error message from server
        let errorMessage = "Could not send promo email. Please try again.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (parseError) {
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      toast({
        title: "Send Failed",
        description: error instanceof Error ? error.message : "Could not send promo email. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex flex-col">
      {/* Top Header - Email Configuration */}
      <div className="bg-white border-b border-gray-200 shadow-sm px-8 py-5 flex-shrink-0">
        <div className="max-w-7xl mx-auto">
          {/* Header Top Row */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-xl flex items-center justify-center shadow-lg">
                  <Send className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Email Campaign Studio</h1>
                  <p className="text-sm text-gray-600">Professional email designer for world-class campaigns</p>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleTestEmail}
                disabled={isTestingEmail || !currentDesign.content.email}
                className="h-10 px-5 border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200"
              >
                {isTestingEmail ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="h-4 w-4 mr-2" />
                )}
                Test Email
              </Button>

              <Button 
                variant="outline" 
                size="sm" 
                className="h-10 px-5 border-gray-300 hover:border-blue-400 hover:bg-blue-50 transition-all duration-200"
              >
                <Save className="h-4 w-4 mr-2" />
                Save Template
              </Button>

              <Button 
                onClick={handleSendPromoEmail}
                disabled={isSending || !currentDesign.content.email}
                className="bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white h-10 px-7 font-medium shadow-lg transition-all duration-200"
              >
                {isSending ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Campaign
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Email Configuration Row */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
            <div>
              <Label className="text-sm font-medium text-gray-700 mb-2 block flex items-center">
                <Mail className="h-4 w-4 mr-1 text-gray-500" />
                To
              </Label>
              <Input
                type="email"
                placeholder="recipient@example.com"
                value={currentDesign.content.email || ''}
                onChange={(e) => updateElementContent('customer-email', e.target.value)}
                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              />
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700 mb-2 block flex items-center">
                <Type className="h-4 w-4 mr-1 text-gray-500" />
                Subject Line
              </Label>
              <Input
                placeholder="Enter your subject line"
                value={currentDesign.content.subject}
                onChange={(e) => handleContentUpdate({ subject: e.target.value })}
                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              />
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700 mb-2 block flex items-center">
                <Eye className="h-4 w-4 mr-1 text-gray-500" />
                Preview Text
              </Label>
              <Input
                placeholder="Email preview text"
                value={currentDesign.content.previewText}
                onChange={(e) => handleContentUpdate({ previewText: e.target.value })}
                className="h-10 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
              />
            </div>

            <div>
              <Label className="text-sm font-medium text-gray-700 mb-2 block flex items-center">
                <Target className="h-4 w-4 mr-1 text-gray-500" />
                Recipient Type
              </Label>
              <Select
                value={currentDesign.content.recipientType || 'customer'}
                onValueChange={(value) => handleContentUpdate({ recipientType: value })}
              >
                <SelectTrigger className="h-10 border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all duration-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">🛍️ Customer</SelectItem>
                  <SelectItem value="chef">👨‍🍳 Chef/Cook</SelectItem>
                  <SelectItem value="general">📧 General</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic Side Panel */}
        <div className="w-80 bg-white border-r border-gray-200 shadow-sm flex flex-col">
          <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <h2 className="font-semibold text-gray-900 mb-2 flex items-center">
              {selectedElement ? (
                <>
                  <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center mr-3">
                    <Palette className="h-4 w-4 text-white" />
                  </div>
                  <span>
                    {selectedElement === 'email-header' && 'Header Settings'}
                    {selectedElement === 'greeting' && 'Greeting Text'}
                    {selectedElement === 'custom-message' && 'Message Content'}
                    {selectedElement === 'promo-code' && 'Promo Code'}
                    {selectedElement === 'promo-code-label' && 'Promo Label'}
                    {selectedElement === 'order-button' && 'Call-to-Action'}
                    {selectedElement.startsWith('section-') && 'Custom Element'}
                  </span>
                </>
              ) : (
                <>
                  <div className="w-7 h-7 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center mr-3">
                    <Plus className="h-4 w-4 text-white" />
                  </div>
                  <span>Add Elements</span>
                </>
              )}
            </h2>
            <p className="text-xs text-gray-600 leading-relaxed">
              {selectedElement ? 'Customize the selected element with professional controls' : 'Click any element in the preview to edit or add new content'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {selectedElement ? (
              <div className="space-y-6">
                {/* Email Header Settings */}
                {selectedElement === 'email-header' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Image className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Header Branding</h3>
                        <p className="text-xs text-gray-500">Logo and header styling</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Header Title</Label>
                        <Input
                          placeholder="Enter header title"
                          value={currentDesign.content.header?.title || ''}
                          onChange={(e) => handleContentUpdate({
                            header: {
                              ...currentDesign.content.header,
                              title: e.target.value
                            }
                          })}
                          className="h-8 text-sm"
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Subtitle</Label>
                        <Input
                          placeholder="Enter subtitle"
                          value={currentDesign.content.header?.subtitle || ''}
                          onChange={(e) => handleContentUpdate({
                            header: {
                              ...currentDesign.content.header,
                              subtitle: e.target.value
                            }
                          })}
                          className="h-8 text-sm"
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-2 block">Background</Label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                            'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
                            'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                            'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)',
                            'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
                            '#1F2937'
                          ].map((gradient, index) => (
                            <button
                              key={index}
                              className={`w-full h-8 rounded-md border-2 transition-all ${
                                currentDesign.content.header?.styling?.backgroundColor === gradient
                                  ? 'border-blue-500 ring-2 ring-blue-200'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                              style={{ background: gradient }}
                              onClick={() => updateElementStyling('email-header', 'backgroundColor', gradient)}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Alignment</Label>
                        <div className="flex space-x-1">
                          {[
                            { value: 'left', icon: AlignLeft },
                            { value: 'center', icon: AlignCenter },
                            { value: 'right', icon: AlignRight }
                          ].map(({ value, icon: Icon }) => (
                            <Button
                              key={value}
                              variant="outline"
                              size="sm"
                              className={`h-8 w-10 p-0 ${
                                currentDesign.content.header?.styling?.textAlign === value
                                  ? 'bg-blue-100 border-blue-300'
                                  : ''
                              }`}
                              onClick={() => updateElementStyling('email-header', 'textAlign', value)}
                            >
                              <Icon className="h-3 w-3" />
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Greeting Text Settings */}
                {selectedElement === 'greeting' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
                        <Type className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Greeting Message</h3>
                        <p className="text-xs text-gray-500">Personalized welcome text</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Greeting Text</Label>
                      <Textarea
                        placeholder="Hi [Customer Name],"
                        value={currentDesign.content.sections?.greeting?.text || `Hi ${currentDesign.content.customerName || '[Customer Name]'},`}
                        onChange={(e) => updateElementContent('greeting', e.target.value)}
                        className="min-h-[60px] text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                        <div className="grid grid-cols-4 gap-1">
                          {['#1f2937', '#374151', '#6b7280', '#dc2626', '#3b82f6', '#10b981'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.sections?.greeting?.styling?.color === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => updateElementStyling('greeting', 'color', color)}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Font Size</Label>
                        <Select
                          value={currentDesign.content.sections?.greeting?.styling?.fontSize || '18px'}
                          onValueChange={(value) => updateElementStyling('greeting', 'fontSize', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="14px">Small (14px)</SelectItem>
                            <SelectItem value="16px">Normal (16px)</SelectItem>
                            <SelectItem value="18px">Medium (18px)</SelectItem>
                            <SelectItem value="20px">Large (20px)</SelectItem>
                            <SelectItem value="24px">X-Large (24px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Style</Label>
                      <div className="flex space-x-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-8 w-10 p-0 ${
                            currentDesign.content.sections?.greeting?.styling?.fontWeight === 'bold'
                              ? 'bg-blue-100 border-blue-300'
                              : ''
                          }`}
                          onClick={() => updateElementStyling('greeting', 'fontWeight', 
                            currentDesign.content.sections?.greeting?.styling?.fontWeight === 'bold' ? 'normal' : 'bold'
                          )}
                        >
                          <Bold className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`h-8 w-10 p-0 ${
                            currentDesign.content.sections?.greeting?.styling?.fontStyle === 'italic'
                              ? 'bg-blue-100 border-blue-300'
                              : ''
                          }`}
                          onClick={() => updateElementStyling('greeting', 'fontStyle', 
                            currentDesign.content.sections?.greeting?.styling?.fontStyle === 'italic' ? 'normal' : 'italic'
                          )}
                        >
                          <Italic className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom Message Settings */}
                {selectedElement === 'custom-message' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <Edit3 className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Message Content</h3>
                        <p className="text-xs text-gray-500">Main email message</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Message Text</Label>
                      <Textarea
                        placeholder="Enter your message content..."
                        value={currentDesign.content.sections?.['custom-message']?.text || ''}
                        onChange={(e) => updateElementContent('custom-message', e.target.value)}
                        className="min-h-[120px] text-sm resize-none border-gray-200 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all duration-200"
                      />
                      <p className="text-xs text-gray-500 mt-1">Minimum 10 characters required</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                        <div className="grid grid-cols-4 gap-1">
                          {['#374151', '#1f2937', '#6b7280', '#dc2626', '#3b82f6', '#10b981'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.sections?.['custom-message']?.styling?.color === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => updateElementStyling('custom-message', 'color', color)}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Font Size</Label>
                        <Select
                          value={currentDesign.content.sections?.['custom-message']?.styling?.fontSize || '16px'}
                          onValueChange={(value) => updateElementStyling('custom-message', 'fontSize', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="14px">Small (14px)</SelectItem>
                            <SelectItem value="16px">Normal (16px)</SelectItem>
                            <SelectItem value="18px">Medium (18px)</SelectItem>
                            <SelectItem value="20px">Large (20px)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Alignment</Label>
                      <div className="flex space-x-1">
                        {[
                          { value: 'left', icon: AlignLeft },
                          { value: 'center', icon: AlignCenter },
                          { value: 'right', icon: AlignRight }
                        ].map(({ value, icon: Icon }) => (
                          <Button
                            key={value}
                            variant="outline"
                            size="sm"
                            className={`h-8 w-10 p-0 ${
                              currentDesign.content.sections?.['custom-message']?.styling?.textAlign === value
                                ? 'bg-blue-100 border-blue-300'
                                : ''
                            }`}
                            onClick={() => updateElementStyling('custom-message', 'textAlign', value)}
                          >
                            <Icon className="h-3 w-3" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Promo Code Settings */}
                {selectedElement === 'promo-code' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg flex items-center justify-center">
                        <Target className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Promo Code</h3>
                        <p className="text-xs text-gray-500">Discount code styling</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Promo Code</Label>
                      <Input
                        placeholder="SAVE20"
                        value={currentDesign.content.promoCode || ''}
                        onChange={(e) => updateElementContent('promo-code', e.target.value)}
                        className="h-8 text-sm font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Background</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#f3f4f6', '#fef3c7', '#dbeafe', '#ecfdf5', '#fce7f3', '#e0e7ff'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.promoCodeStyling?.backgroundColor === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                promoCodeStyling: {
                                  ...currentDesign.content.promoCodeStyling,
                                  backgroundColor: color
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#9ca3af', '#f59e0b', '#3b82f6', '#10b981', '#ec4899', '#8b5cf6'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.promoCodeStyling?.borderColor === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                promoCodeStyling: {
                                  ...currentDesign.content.promoCodeStyling,
                                  borderColor: color
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                      <div className="grid grid-cols-6 gap-1">
                        {['#1f2937', '#374151', '#dc2626', '#3b82f6', '#10b981', '#8b5cf6'].map(color => (
                          <button
                            key={color}
                            className={`w-6 h-6 rounded border-2 ${
                              currentDesign.content.promoCodeStyling?.textColor === color
                                ? 'border-blue-500'
                                : 'border-gray-200'
                            }`}
                            style={{ backgroundColor: color }}
                            onClick={() => handleContentUpdate({
                              promoCodeStyling: {
                                ...currentDesign.content.promoCodeStyling,
                                textColor: color
                              }
                            })}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Promo Code Label Settings */}
                {selectedElement === 'promo-code-label' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-lg flex items-center justify-center">
                        <Type className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Promo Label</h3>
                        <p className="text-xs text-gray-500">Code description text</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Label Text</Label>
                      <Input
                        placeholder="Use promo code:"
                        value={currentDesign.content.promoCodeLabel || ''}
                        onChange={(e) => updateElementContent('promo-code-label', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#374151', '#1f2937', '#6b7280', '#dc2626', '#3b82f6', '#10b981'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.promoCodeStyling?.labelColor === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                promoCodeStyling: {
                                  ...currentDesign.content.promoCodeStyling,
                                  labelColor: color
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Font Weight</Label>
                        <Select
                          value={currentDesign.content.promoCodeStyling?.labelFontWeight || '600'}
                          onValueChange={(value) => handleContentUpdate({
                            promoCodeStyling: {
                              ...currentDesign.content.promoCodeStyling,
                              labelFontWeight: value
                            }
                          })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="400">Normal</SelectItem>
                            <SelectItem value="500">Medium</SelectItem>
                            <SelectItem value="600">Semibold</SelectItem>
                            <SelectItem value="700">Bold</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Order Button Settings */}
                {selectedElement === 'order-button' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center">
                        <Square className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Call-to-Action</h3>
                        <p className="text-xs text-gray-500">Primary action button</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Button Text</Label>
                      <Input
                        placeholder="Order Now"
                        value={currentDesign.content.sections?.['order-button']?.text || currentDesign.content.buttonText || ''}
                        onChange={(e) => updateElementContent('order-button', e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Button URL</Label>
                      <Input
                        placeholder="https://example.com"
                        value={currentDesign.content.sections?.['order-button']?.url || currentDesign.content.orderUrl || ''}
                        onChange={(e) => {
                          const section = currentDesign.content.sections?.['order-button'];
                          if (section) {
                            const updatedSections = {
                              ...currentDesign.content.sections,
                              'order-button': { ...section, url: e.target.value }
                            };
                            handleContentUpdate({ sections: updatedSections });
                          } else {
                            handleContentUpdate({ orderUrl: e.target.value });
                          }
                        }}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Background</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#dc2626', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.sections?.['order-button']?.styling?.backgroundColor === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => updateElementStyling('order-button', 'backgroundColor', color)}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#ffffff', '#1f2937', '#374151'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${
                                currentDesign.content.sections?.['order-button']?.styling?.color === color
                                  ? 'border-blue-500'
                                  : 'border-gray-200'
                              }`}
                              style={{ backgroundColor: color }}
                              onClick={() => updateElementStyling('order-button', 'color', color)}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Button Alignment</Label>
                      <div className="flex space-x-1">
                        {[
                          { value: 'left', icon: AlignLeft },
                          { value: 'center', icon: AlignCenter },
                          { value: 'right', icon: AlignRight }
                        ].map(({ value, icon: Icon }) => (
                          <Button
                            key={value}
                            variant="outline"
                            size="sm"
                            className={`h-8 w-10 p-0 ${
                              currentDesign.content.sections?.['order-button']?.styling?.alignment === value
                                ? 'bg-blue-100 border-blue-300'
                                : ''
                            }`}
                            onClick={() => updateElementStyling('order-button', 'alignment', value)}
                          >
                            <Icon className="h-3 w-3" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Custom Section Settings */}
                {selectedElement?.startsWith('section-') && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center">
                          <Settings className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <h3 className="font-medium text-gray-900">Custom Element</h3>
                          <p className="text-xs text-gray-500">Edit custom content</p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => removeSection(selectedElement)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Delete
                      </Button>
                    </div>

                    {currentDesign.content.sections[selectedElement]?.type === 'text' && (
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Content</Label>
                        <Textarea
                          placeholder="Enter text content..."
                          value={currentDesign.content.sections[selectedElement]?.text || ''}
                          onChange={(e) => updateElementContent(selectedElement, e.target.value)}
                          className="min-h-[80px] text-sm"
                        />
                      </div>
                    )}

                    {currentDesign.content.sections[selectedElement]?.type === 'button' && (
                      <>
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Button Text</Label>
                          <Input
                            placeholder="Button text"
                            value={currentDesign.content.sections[selectedElement]?.text || ''}
                            onChange={(e) => updateElementContent(selectedElement, e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Button URL</Label>
                          <Input
                            placeholder="https://example.com"
                            value={currentDesign.content.sections[selectedElement]?.url || ''}
                            onChange={(e) => {
                              const section = currentDesign.content.sections[selectedElement];
                              if (section) {
                                const updatedSections = {
                                  ...currentDesign.content.sections,
                                  [selectedElement]: { ...section, url: e.target.value }
                                };
                                handleContentUpdate({ sections: updatedSections });
                              }
                            }}
                            className="h-8 text-sm"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Button 
                  variant="outline" 
                  className="w-full justify-start h-10 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                  onClick={() => addSection('text')}
                >
                  <Type className="h-4 w-4 mr-3 text-gray-400" />
                  <span className="text-sm">Add Text Block</span>
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full justify-start h-10 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                  onClick={() => addSection('button')}
                >
                  <Square className="h-4 w-4 mr-3 text-gray-400" />
                  <span className="text-sm">Add Button</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Email Preview Area */}
        <div className="flex-1 bg-gradient-to-br from-gray-50 to-blue-50 p-8 overflow-auto">
          <div className="max-w-2xl mx-auto">
            {/* Preview Header */}
            <div className="mb-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Email Preview</h3>
              <p className="text-sm text-gray-600">Real-time preview of your email campaign</p>
            </div>
            
            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-200 transform hover:shadow-2xl transition-all duration-300">
              {/* Email Header */}
              <div 
                className={`text-white cursor-pointer transition-all duration-200 relative group ${
                  selectedElement === 'email-header' ? 'ring-4 ring-blue-400 ring-opacity-50' : ''
                }`}
                style={{ 
                  background: currentDesign.content.header?.styling?.backgroundColor || 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)',
                  padding: currentDesign.content.header?.styling?.padding || '24px 32px',
                  textAlign: (currentDesign.content.header?.styling?.textAlign || 'center') as React.CSSProperties['textAlign']
                }}
                onClick={() => setSelectedElement('email-header')}
              >
                {selectedElement !== 'email-header' && (
                  <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-10 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                    <div className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-medium">
                      Click to edit header
                    </div>
                  </div>
                )}
                
                <img 
                  src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" 
                  alt="Local Cooks" 
                  style={{
                    maxWidth: '280px',
                    height: 'auto',
                    display: 'block',
                    margin: '0 auto'
                  }}
                />
                {currentDesign.content.header?.title && (
                  <div style={{ marginTop: '16px' }}>
                    <h2 style={{
                      fontSize: currentDesign.content.header.styling?.titleFontSize || '24px',
                      fontWeight: '600',
                      color: currentDesign.content.header.styling?.titleColor || '#ffffff',
                      margin: '0 0 8px 0'
                    }}>
                      {currentDesign.content.header.title}
                    </h2>
                    {currentDesign.content.header.subtitle && (
                      <p style={{
                        fontSize: currentDesign.content.header.styling?.subtitleFontSize || '16px',
                        color: currentDesign.content.header.styling?.subtitleColor || '#ffffff',
                        margin: '0',
                        opacity: 0.9
                      }}>
                        {currentDesign.content.header.subtitle}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Email Content Body */}
              <div className="p-10 space-y-8 bg-gradient-to-b from-white to-gray-50">
                {/* Greeting Section */}
                <div 
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${
                    selectedElement === 'greeting' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedElement('greeting')}
                >
                  {selectedElement !== 'greeting' && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                      <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                        Edit greeting
                      </div>
                    </div>
                  )}
                  
                  <p style={{
                    fontSize: currentDesign.content.sections?.greeting?.styling?.fontSize || '18px',
                    color: currentDesign.content.sections?.greeting?.styling?.color || '#1f2937',
                    textAlign: (currentDesign.content.sections?.greeting?.styling?.textAlign || 'left') as React.CSSProperties['textAlign'],
                    fontWeight: currentDesign.content.sections?.greeting?.styling?.fontWeight || 'normal',
                    fontStyle: currentDesign.content.sections?.greeting?.styling?.fontStyle || 'normal',
                    margin: '0',
                    lineHeight: '1.6'
                  }}>
                    {currentDesign.content.sections?.greeting?.text || `Hi ${currentDesign.content.customerName || '[Customer Name]'},`}
                  </p>
                </div>

                {/* Custom Message Section */}
                <div 
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${
                    selectedElement === 'custom-message' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedElement('custom-message')}
                >
                  {selectedElement !== 'custom-message' && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                      <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                        Edit message
                      </div>
                    </div>
                  )}
                  
                  <div style={{
                    fontSize: currentDesign.content.sections?.['custom-message']?.styling?.fontSize || '16px',
                    color: currentDesign.content.sections?.['custom-message']?.styling?.color || '#374151',
                    textAlign: (currentDesign.content.sections?.['custom-message']?.styling?.textAlign || 'left') as React.CSSProperties['textAlign'],
                    fontWeight: currentDesign.content.sections?.['custom-message']?.styling?.fontWeight || 'normal',
                    fontStyle: currentDesign.content.sections?.['custom-message']?.styling?.fontStyle || 'normal',
                    lineHeight: '1.7'
                  }} dangerouslySetInnerHTML={{ 
                    __html: (currentDesign.content.sections?.['custom-message']?.text || currentDesign.content.message || 'We have an exclusive offer just for you!').replace(/\n/g, '<br/>') 
                  }} />
                </div>

                {/* Promo Code Section */}
                <div 
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${
                    selectedElement === 'promo-code' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedElement('promo-code')}
                >
                  {selectedElement !== 'promo-code' && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                      <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                        Edit promo code
                      </div>
                    </div>
                  )}
                  
                  <div style={{ textAlign: 'center', margin: '32px 0' }}>
                    <div 
                      className={`cursor-pointer transition-all duration-200 relative group ${
                        selectedElement === 'promo-code-label' ? 'ring-2 ring-blue-400' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement('promo-code-label');
                      }}
                      style={{ marginBottom: '12px' }}
                    >
                      <p style={{
                        fontSize: currentDesign.content.promoCodeStyling?.labelFontSize || '16px',
                        color: currentDesign.content.promoCodeStyling?.labelColor || '#374151',
                        fontWeight: currentDesign.content.promoCodeStyling?.labelFontWeight || '600',
                        margin: '0'
                      }}>
                        {currentDesign.content.promoCodeLabel || 'Use promo code:'}
                      </p>
                    </div>
                    
                    <div style={{
                      backgroundColor: currentDesign.content.promoCodeStyling?.backgroundColor || '#f3f4f6',
                      border: `2px dashed ${currentDesign.content.promoCodeStyling?.borderColor || '#9ca3af'}`,
                      borderRadius: '12px',
                      padding: '20px',
                      display: 'inline-block',
                      minWidth: '200px'
                    }}>
                      <span style={{
                        fontSize: currentDesign.content.promoCodeStyling?.fontSize || '24px',
                        fontWeight: currentDesign.content.promoCodeStyling?.fontWeight || 'bold',
                        color: currentDesign.content.promoCodeStyling?.textColor || '#1f2937',
                        fontFamily: 'monospace',
                        letterSpacing: '2px'
                      }}>
                        {currentDesign.content.promoCode || 'SAVE20'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* CTA Button Section */}
                <div 
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${
                    selectedElement === 'order-button' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedElement('order-button')}
                  style={{ textAlign: (currentDesign.content.sections?.['order-button']?.styling?.alignment || 'center') as React.CSSProperties['textAlign'] }}
                >
                  {selectedElement !== 'order-button' && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                      <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                        Edit button
                      </div>
                    </div>
                  )}
                  
                  <a
                    href={currentDesign.content.sections?.['order-button']?.url || currentDesign.content.orderUrl || '#'}
                    style={{
                      display: 'inline-block',
                      backgroundColor: currentDesign.content.sections?.['order-button']?.styling?.backgroundColor || '#dc2626',
                      color: currentDesign.content.sections?.['order-button']?.styling?.color || '#ffffff',
                      padding: '16px 32px',
                      borderRadius: '8px',
                      textDecoration: 'none',
                      fontWeight: '600',
                      fontSize: currentDesign.content.sections?.['order-button']?.styling?.fontSize || '16px',
                      transition: 'all 0.2s ease',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {currentDesign.content.sections?.['order-button']?.text || currentDesign.content.buttonText || 'Order Now'}
                  </a>
                </div>

                {/* Custom Sections */}
                {currentDesign.content.sections && Object.entries(currentDesign.content.sections)
                  .filter(([key]) => key.startsWith('section-'))
                  .map(([sectionId, section]) => (
                    <div 
                      key={sectionId}
                      className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${
                        selectedElement === sectionId ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedElement(sectionId)}
                    >
                      {selectedElement !== sectionId && (
                        <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                          <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                            Edit {section.type}
                          </div>
                        </div>
                      )}
                      
                      {section.type === 'text' && (
                        <div style={{
                          fontSize: section.styling?.fontSize || '16px',
                          color: section.styling?.color || '#374151',
                          textAlign: (section.styling?.textAlign || 'left') as React.CSSProperties['textAlign'],
                          fontWeight: section.styling?.fontWeight || 'normal',
                          fontStyle: section.styling?.fontStyle || 'normal',
                          lineHeight: '1.6'
                        }} dangerouslySetInnerHTML={{ __html: (section.text || 'New text block').replace(/\n/g, '<br/>') }} />
                      )}
                      
                      {section.type === 'button' && (
                        <div style={{ textAlign: (section.styling?.alignment || 'center') as React.CSSProperties['textAlign'] }}>
                          <a
                            href={section.url || '#'}
                            style={{
                              display: 'inline-block',
                              backgroundColor: section.styling?.backgroundColor || '#3b82f6',
                              color: section.styling?.color || '#ffffff',
                              padding: '12px 24px',
                              borderRadius: '6px',
                              textDecoration: 'none',
                              fontWeight: '500',
                              fontSize: section.styling?.fontSize || '14px'
                            }}
                          >
                            {section.text || 'New Button'}
                          </a>
                        </div>
                      )}
                    </div>
                  ))}

                {/* Footer */}
                <div className="mt-12 pt-6 border-t border-gray-200">
                  <p style={{
                    fontSize: '12px',
                    color: '#9ca3af',
                    textAlign: 'center',
                    margin: '0',
                    lineHeight: '1.5'
                  }}>
                    © 2024 Local Cooks Community. All rights reserved.<br/>
                    This email was sent to {currentDesign.content.email || '[customer-email]'}
                  </p>
                </div>
              </div>
            </div>

            {/* Preview Controls */}
            <div className="mt-6 flex justify-center space-x-4">
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
                <Eye className="h-3 w-3 mr-1" />
                Desktop
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
                📱 Mobile
              </Button>
              <Button variant="outline" size="sm" className="h-8 px-3 text-xs">
                <Download className="h-3 w-3 mr-1" />
                Export
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 