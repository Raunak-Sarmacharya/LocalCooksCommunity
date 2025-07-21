import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Mail } from "lucide-react";
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
  sections: { [key: string]: EmailSection }; // Changed from array to object to match EmailDesignStudio
  promoCode?: string;
  promoCodeLabel?: string;
  includePromoCode?: boolean; // Toggle for promo code section
  message?: string; // Add message property
  customMessage?: string;
  greeting?: string;
  buttonText?: string; // Add buttonText property
  orderUrl?: string; // Add orderUrl property
  email?: string;
  recipientType?: string;
  // Add new fields for custom email mode
  customEmails?: string[];
  emailMode?: 'database' | 'custom';
  promoCodeStyling?: {
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
    fontSize?: string;
    fontWeight?: string;
    labelColor?: string;
    labelFontSize?: string;
    labelFontWeight?: string;
    borderRadius?: string;
    borderWidth?: string;
    borderStyle?: string;
    boxShadow?: string;
    padding?: string;
  };
  orderButton?: {
    text?: string;
    url?: string;
    styling?: {
      backgroundColor?: string;
      color?: string;
      fontSize?: string;
      fontWeight?: string;
      padding?: string;
      borderRadius?: string;
      textAlign?: string;
    };
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
      backgroundImage?: string;
      backgroundSize?: string;
      backgroundPosition?: string;
      backgroundRepeat?: string;
      backgroundAttachment?: string;
    };
  };
  footer?: {
    mainText?: string;
    contactText?: string;
    copyrightText?: string;
    showContact?: boolean;
    showCopyright?: boolean;
    styling?: {
      backgroundColor?: string;
      textColor?: string;
      linkColor?: string;
      fontSize?: string;
      padding?: string;
      textAlign?: string;
      borderColor?: string;
    };
  };
  usageSteps?: {
    title?: string;
    steps?: string[];
    enabled?: boolean;
    styling?: {
      backgroundColor?: string;
      borderColor?: string;
      titleColor?: string;
      textColor?: string;
      linkColor?: string;
      padding?: string;
      borderRadius?: string;
    };
  };
  emailContainer?: {
    maxWidth?: string;
    backgroundColor?: string;
    borderRadius?: string;
    boxShadow?: string;
    backgroundImage?: string;
    backgroundSize?: string;
    backgroundPosition?: string;
    backgroundRepeat?: string;
    backgroundAttachment?: string;
    mobileMaxWidth?: string;
    mobilePadding?: string;
    mobileFontScale?: string;
    mobileButtonSize?: string;
  };
  dividers?: {
    enabled?: boolean;
    style?: string;
    color?: string;
    thickness?: string;
    margin?: string;
    opacity?: string;
  };
}

interface EmailSection {
  id: string;
  type: string;
  text?: string;
  content?: string;
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
    lineHeight?: string;
    letterSpacing?: string;
    textTransform?: string;
    margin?: string;
    marginTop?: string;
    marginRight?: string;
    marginBottom?: string;
    marginLeft?: string;
    paddingTop?: string;
    paddingRight?: string;
    paddingBottom?: string;
    paddingLeft?: string;
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

const PromoCodeSender: React.FC = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  // Single email design state
  const [emailDesign, setEmailDesign] = useState<EmailDesignData>({
    id: `email-design-${Date.now()}`,
    name: 'Custom Email Template',
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
      sections: {},
      promoCode: 'WELCOME20',
      promoCodeLabel: '🎁 Special Offer Code',
      includePromoCode: true, // Toggle for promo code section
      customMessage: 'We\'re excited to share this special offer with you! Use the code below to enjoy exclusive savings on your next order.',
      greeting: 'Hello! 👋',
      email: '',
      recipientType: 'customer',
      // Add new fields for custom email mode
      customEmails: [],
      emailMode: 'database',
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
      orderButton: {
        text: '🌟 Get Started',
        url: 'https://localcooks.ca',
        styling: {
          backgroundColor: '#F51042',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: '600',
          padding: '14px 28px',
          borderRadius: '8px',
          textAlign: 'center'
        }
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
      },
      footer: {
        mainText: 'Thank you for being part of the Local Cooks community!',
        contactText: 'Questions? Contact us at support@localcooks.com',
        copyrightText: '© 2024 Local Cooks. All rights reserved.',
        showContact: true,
        showCopyright: true,
        styling: {
          backgroundColor: '#f8fafc',
          textColor: '#64748b',
          linkColor: '#F51042',
          fontSize: '14px',
          padding: '24px 32px',
          textAlign: 'center',
          borderColor: '#e2e8f0'
        }
      },
      usageSteps: {
        title: '🚀 How to use your promo code:',
        steps: [
          'Visit our website: https://localcooks.ca',
          'Browse our amazing local cooks and their delicious offerings',
          'Apply your promo code during checkout',
          'Enjoy your special offer!'
        ],
        enabled: true,
        styling: {
          backgroundColor: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
          borderColor: '#93c5fd',
          titleColor: '#1d4ed8',
          textColor: '#1e40af',
          linkColor: '#1d4ed8',
          padding: '20px',
          borderRadius: '8px'
        }
      },
      emailContainer: {
        maxWidth: '600px',
        backgroundColor: '#f1f5f9',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
      },
      dividers: {
        enabled: true,
        style: 'solid',
        color: '#e2e8f0',
        thickness: '1px',
        margin: '24px 0',
        opacity: '1'
      }
    },
    metadata: {
      version: '1.0',
      lastModified: new Date(),
      author: 'Admin',
      tags: ['campaign', 'communication'],
      performance: { openRate: 0, clickRate: 0, conversionRate: 0 }
    }
  });

  // Handle email design update
  const handleEmailDesignUpdate = useCallback((updatedDesign: EmailDesignData) => {
    // Ensure header always uses brand color
    const designWithBrandColor = {
      ...updatedDesign,
      content: {
        ...updatedDesign.content,
        header: {
          ...updatedDesign.content.header,
          styling: {
            ...updatedDesign.content.header?.styling,
            backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' // Always enforce brand color
          }
        }
      }
    };
    setEmailDesign(designWithBrandColor);
  }, []);

  // Send email function
  const sendEmail = async () => {
    // Validate that we have required fields
    if (!emailDesign.content.promoCode || !emailDesign.content.customMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in offer code and message",
        variant: "destructive"
      });
      return;
    }

    // Validate required fields before sending
    // Only validate promo code if it's included
    if (emailDesign.content.includePromoCode && (!emailDesign.content.promoCode || emailDesign.content.promoCode.length < 3)) {
      toast({
        title: "Invalid Offer Code",
        description: "Offer code must be at least 3 characters long",
        variant: "destructive"
      });
      return;
    }

    if (!emailDesign.content.customMessage || emailDesign.content.customMessage.length < 10) {
      toast({
        title: "Invalid Message",
        description: "Message must be at least 10 characters long",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Essential for session-based admin auth
        body: JSON.stringify({
          email: emailDesign.content.email,
          promoCode: emailDesign.content.includePromoCode ? emailDesign.content.promoCode : '',
          customMessage: emailDesign.content.customMessage,
          greeting: emailDesign.content.greeting,
          recipientType: emailDesign.content.recipientType,
          designSystem: emailDesign.designSystem,
          isPremium: true,
          sections: emailDesign.content.sections,
          orderButton: emailDesign.content.orderButton,
          header: emailDesign.content.header,
          footer: emailDesign.content.footer,
          usageSteps: emailDesign.content.usageSteps,
          emailContainer: emailDesign.content.emailContainer,
          dividers: emailDesign.content.dividers,
          promoCodeStyling: emailDesign.content.promoCodeStyling,
          promoCodeLabel: emailDesign.content.promoCodeLabel,
          subject: emailDesign.content.subject,
          previewText: emailDesign.content.previewText
        }),
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: "✅ Email Sent Successfully!",
          description: `Email sent successfully`,
        });
        
        // Reset form after successful send
        setEmailDesign(prev => ({
          ...prev,
          content: {
            ...prev.content,
            email: '',
            promoCode: '',
            includePromoCode: true,
            customMessage: '',
            greeting: 'Hello! 👋'
          }
        }));
      } else {
        // Get detailed error message from server
        let errorMessage = "Failed to send email";
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
        description: error instanceof Error ? error.message : "Failed to send email",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center text-gray-900">
            <Mail className="h-6 w-6 mr-2 text-blue-500" />
            Email Campaign Manager
          </CardTitle>
          <CardDescription>
            Send customized promotional emails to customers and chefs with consistent branding
          </CardDescription>
        </CardHeader>
      </Card>



      {/* Email Design Studio */}
      <EmailDesignStudio
        onEmailGenerated={handleEmailDesignUpdate}
        initialDesign={emailDesign}
      />
    </div>
  );
};

export default PromoCodeSender; 