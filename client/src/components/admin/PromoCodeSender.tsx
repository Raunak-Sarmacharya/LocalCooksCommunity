import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Crown } from "lucide-react";
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
    };
  };
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
  const [isLoading, setIsLoading] = useState(false);
  
  // Single email design state - no more simple/advanced toggle
  const [emailDesign, setEmailDesign] = useState<EmailDesignData>({
    id: `promo-design-${Date.now()}`,
    name: 'Promo Email Design',
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
      email: '',
      orderButton: {
        text: '🌟 Start Shopping Now',
        url: 'https://localcooks.com',
        styling: {
          backgroundColor: '#F51042',
          color: '#ffffff',
          fontSize: '16px',
          fontWeight: '600',
          padding: '14px 28px',
          borderRadius: '8px',
          textAlign: 'center'
        }
      }
    },
    metadata: {
      version: '1.0',
      lastModified: new Date(),
      author: 'Admin',
      tags: ['promo', 'marketing'],
      performance: { openRate: 0, clickRate: 0, conversionRate: 0 }
    }
  });

  // Handle email design update
  const handleEmailDesignUpdate = useCallback((updatedDesign: EmailDesignData) => {
    setEmailDesign(updatedDesign);
  }, []);

  // Send email function
  const sendEmail = async () => {
    if (!emailDesign.content.email || !emailDesign.content.promoCode || !emailDesign.content.customMessage) {
      toast({
        title: "Missing Information",
        description: "Please fill in customer email, promo code, and custom message",
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
          email: emailDesign.content.email,
          promoCode: emailDesign.content.promoCode,
          customMessage: emailDesign.content.customMessage,
          designSystem: emailDesign.designSystem,
          isPremium: true,
          sections: emailDesign.content.sections,
          orderButton: emailDesign.content.orderButton,
          header: emailDesign.content.header,
          subject: emailDesign.content.subject,
          previewText: emailDesign.content.previewText
        }),
      });

      if (response.ok) {
        toast({
          title: "🎉 Email Sent Successfully!",
          description: `Promo email sent to ${emailDesign.content.email}`,
        });
        
        // Reset form after successful send
        setEmailDesign(prev => ({
          ...prev,
          content: {
            ...prev.content,
            email: '',
            promoCode: '',
            customMessage: ''
          }
        }));
      } else {
        const error = await response.text();
        throw new Error(error);
      }
    } catch (error) {
      toast({
        title: "Send Failed",
        description: error instanceof Error ? error.message : "Failed to send promo email",
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
            <Crown className="h-6 w-6 mr-2 text-yellow-500" />
            Premium Email Designer
          </CardTitle>
          <CardDescription>
            Create beautiful, professional promo emails with our comprehensive design studio
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