import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from "@/hooks/use-toast"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Download,
  Edit3,
  Eye,
  Image,
  Italic,
  Mail,
  Minus,
  Palette,
  Plus,
  Send,
  Settings,
  Square,
  Target,
  Trash2,
  Type
} from 'lucide-react'
import React, { useState } from 'react'
import { SimpleUserSelector } from '../../ui/SimpleUserSelector'

interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  displayText: string;
}

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
  greeting?: string;
  buttonText?: string;
  orderUrl?: string;
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
  customerName?: string;
  email?: string;
  recipients?: User[];
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
  content?: string; // Add missing content property
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

  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [selectedUsers, setSelectedUsers] = useState<User[]>(
    initialDesign?.content?.recipients || []
  );

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
        orderUrl: 'https://localcooks.ca',
        customerName: 'Valued Customer',
        email: '',
        recipients: [],
        promoCodeStyling: {
          backgroundColor: '#f3f4f6',
          borderColor: '#9ca3af',
          textColor: '#1f2937',
          fontSize: '24px',
          fontWeight: 'bold',
          labelColor: '#374151',
          labelFontSize: '16px',
          labelFontWeight: '600',
          borderRadius: '8px',
          borderWidth: '2px',
          borderStyle: 'solid',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          padding: '16px 24px'
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
    };
  }

  // Handle content updates
  const handleContentUpdate = (content: Partial<EmailContent>) => {
    // Ensure header always uses brand color
    if (content.header) {
      content.header = {
        ...content.header,
        styling: {
          ...content.header.styling,
          backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' // Always enforce brand color
        }
      };
    }

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
      // Prevent changes to header background color and image to maintain brand consistency
      if (property === 'backgroundColor' || property === 'backgroundImage') {
        console.log('Header background changes are disabled to maintain brand consistency');
        return;
      }

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
    } else if (elementId === 'order-button') {
      const orderButtonSection = currentDesign.content.sections['order-button'];
      if (orderButtonSection) {
        const updatedSections = {
          ...currentDesign.content.sections,
          'order-button': {
            ...orderButtonSection,
            styling: {
              ...orderButtonSection.styling,
              [property]: value
            }
          }
        };
        handleContentUpdate({ sections: updatedSections });
      } else {
        const newOrderButtonSection: EmailSection = {
          id: 'order-button-section',
          type: 'order-button',
          text: currentDesign.content.buttonText || 'Get Started',
          url: currentDesign.content.orderUrl || 'https://localcooks.ca',
          styling: {
            backgroundColor: '#F51042',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '600',
            textAlign: 'center',
            [property]: value
          }
        };
        handleContentUpdate({ sections: { ...currentDesign.content.sections, 'order-button': newOrderButtonSection } });
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
      // Update both buttonText and order-button section for consistency
      const orderButtonSection = currentDesign.content.sections['order-button'];
      if (orderButtonSection) {
        const updatedSections = {
          ...currentDesign.content.sections,
          'order-button': {
            ...orderButtonSection,
            text: content
          }
        };
        handleContentUpdate({
          buttonText: content,
          sections: updatedSections
        });
      } else {
        const newOrderButtonSection: EmailSection = {
          id: 'order-button-section',
          type: 'order-button',
          text: content,
          url: currentDesign.content.orderUrl || 'https://localcooks.ca',
          styling: {
            backgroundColor: '#F51042',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '600',
            textAlign: 'center'
          }
        };
        handleContentUpdate({
          buttonText: content,
          sections: {
            ...currentDesign.content.sections,
            'order-button': newOrderButtonSection
          }
        });
      }
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



  // Send promo email

  const handleSendPromoEmail = async () => {
    if (selectedUsers.length === 0) {
      toast({
        title: "Recipients Required",
        description: "Please select users to send the email to",
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

    // Check message from both possible sources (message field and sections)
    const messageFromSections = currentDesign.content.sections?.['custom-message']?.text ||
      currentDesign.content.sections?.['custom-message-section']?.text || '';
    const messageContent = currentDesign.content.message || messageFromSections;

    console.log('Email validation debug:', {
      messageFromContent: currentDesign.content.message,
      messageFromSections: messageFromSections,
      finalMessageContent: messageContent,
      messageLength: messageContent?.length,
      promoCode: currentDesign.content.promoCode,
      email: currentDesign.content.email
    });

    if (!messageContent || messageContent.length < 10) {
      toast({
        title: "Custom Message Required",
        description: `Please enter a custom message (at least 10 characters). Current: ${messageContent?.length || 0} characters`,
        variant: "destructive"
      });
      return;
    }

    setIsSending(true);
    try {
      // Convert sections from object format to array format for backend consistency
      const sectionsArray = currentDesign.content.sections ?
        Object.entries(currentDesign.content.sections).map(([key, section]) => ({
          id: key,
          type: section.type || 'text',
          content: section.text || section.content || '',
          text: section.text || section.content || '', // Add both for compatibility
          styling: section.styling || {}
        })) : [];

      // Get greeting from sections or direct field
      const greetingFromSections = currentDesign.content.sections?.['greeting']?.text ||
        currentDesign.content.sections?.['greeting-section']?.text || '';
      const finalGreeting = greetingFromSections || currentDesign.content.greeting || 'Hello! 👋';

      // Prepare order button data with proper fallbacks (prioritize sections data for consistency)
      const orderButton = {
        text: currentDesign.content.sections?.['order-button']?.text || currentDesign.content.buttonText || currentDesign.content.orderButton?.text || '🌟 Get Started',
        url: currentDesign.content.sections?.['order-button']?.url || currentDesign.content.orderUrl || currentDesign.content.orderButton?.url || 'https://localcooks.ca',
        styling: {
          backgroundColor: currentDesign.content.sections?.['order-button']?.styling?.backgroundColor || '#F51042',
          color: currentDesign.content.sections?.['order-button']?.styling?.color || '#ffffff',
          fontSize: '16px',
          fontWeight: '600',
          padding: '14px 28px',
          borderRadius: '8px',
          textAlign: 'center',
          ...currentDesign.content.orderButton?.styling,
          ...currentDesign.content.sections?.['order-button']?.styling
        }
      };

      // Prepare recipients list
      const recipients = selectedUsers.length > 0 
        ? selectedUsers.map(user => ({ email: user.email, name: user.fullName }))
        : [{ email: currentDesign.content.email, name: 'Recipient' }];

      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Essential for session-based admin auth
        body: JSON.stringify({
          recipients: recipients,
          email: currentDesign.content.email, // Keep for backward compatibility
          promoCode: currentDesign.content.promoCode,
          promoCodeLabel: currentDesign.content.promoCodeLabel,
          customMessage: messageContent, // Use customMessage (preferred by backend)
          message: messageContent, // Also send as message for compatibility
          greeting: finalGreeting,
          buttonText: orderButton.text,
          orderUrl: orderButton.url,
          orderButton: orderButton,
          promoCodeStyling: currentDesign.content.promoCodeStyling,
          promoStyle: { colorTheme: 'green', borderStyle: 'dashed' }, // Add default promo style
          designSystem: currentDesign.designSystem,
          isPremium: true,
          sections: sectionsArray, // Send as array format
          header: currentDesign.content.header,
          footer: currentDesign.content.footer, // Add footer
          usageSteps: currentDesign.content.usageSteps, // Add usage steps
          emailContainer: currentDesign.content.emailContainer, // Add email container
          dividers: currentDesign.content.dividers, // Add dividers
          subject: currentDesign.content.subject,
          previewText: currentDesign.content.previewText,
          customDesign: currentDesign // Keep for debugging if needed
        })
      });

      if (response.ok) {
        const result = await response.json();
        const recipientCount = recipients.length;
        const recipientText = recipientCount === 1 
          ? recipients[0].email 
          : `${recipientCount} recipients`;
        
        toast({
          title: "✅ Promo Email Sent!",
          description: `Promo email sent to ${recipientText}`
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
                onClick={handleSendPromoEmail}
                disabled={isSending || selectedUsers.length === 0}
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
            <div className="lg:col-span-2">
              <Label className="text-sm font-medium text-gray-700 mb-2 block flex items-center">
                <Mail className="h-4 w-4 mr-1 text-gray-500" />
                Recipients
              </Label>
              <SimpleUserSelector
                selectedUsers={selectedUsers}
                onUsersChange={(users) => {
                  setSelectedUsers(users);
                  // Update the email content with selected users
                  handleContentUpdate({ 
                    recipients: users,
                    email: users.length > 0 ? users[0].email : '' // Keep first email for backward compatibility
                  });
                }}
                placeholder="Search and select users by name or email..."
                maxUsers={50}
                className="w-full"
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


          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic Side Panel */}
        <div className="w-80 bg-white border-r border-gray-200 shadow-sm flex flex-col">
          <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-blue-50">
            <h2 className="font-semibold text-gray-900 mb-2 flex items-center justify-between">
              {selectedElement ? (
                <div className="flex items-center">
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
                    {selectedElement === 'dividers' && 'Divider Styling'}
                    {selectedElement === 'mobile-settings' && 'Mobile Controls'}
                    {selectedElement.startsWith('section-') && 'Custom Element'}
                  </span>
                </div>
              ) : (
                <div className="flex items-center">
                  <div className="w-7 h-7 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center mr-3">
                    <Plus className="h-4 w-4 text-white" />
                  </div>
                  <span>Add Elements</span>
                </div>
              )}
              
              {/* Back Button */}
              {selectedElement && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedElement(null)}
                  className="flex items-center space-x-1 text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="text-sm">Back</span>
                </Button>
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
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                          <div
                            className="w-full h-8 rounded-md border-2 border-red-300"
                            style={{ background: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' }}
                          />
                          <p className="text-xs text-red-700 mt-2">
                            <strong>Brand Color:</strong> Header uses your Local Cooks brand color for consistent branding.
                          </p>
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
                              className={`h-8 w-10 p-0 ${currentDesign.content.header?.styling?.textAlign === value
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

                      <div className="border-t pt-4">
                        <Label className="text-xs font-medium text-gray-600 mb-3 block">Background Image</Label>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Background Image</Label>
                          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-xs text-red-700">
                              <strong>Disabled:</strong> Background images are disabled for the header to maintain brand consistency.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 mt-3">
                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Size</Label>
                            <Select
                              value={currentDesign.content.header?.styling?.backgroundSize || 'cover'}
                              onValueChange={(value) => updateElementStyling('email-header', 'backgroundSize', value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cover">Cover</SelectItem>
                                <SelectItem value="contain">Contain</SelectItem>
                                <SelectItem value="auto">Auto</SelectItem>
                                <SelectItem value="100% 100%">Stretch</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Position</Label>
                            <Select
                              value={currentDesign.content.header?.styling?.backgroundPosition || 'center center'}
                              onValueChange={(value) => updateElementStyling('email-header', 'backgroundPosition', value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="center center">Center</SelectItem>
                                <SelectItem value="top center">Top</SelectItem>
                                <SelectItem value="bottom center">Bottom</SelectItem>
                                <SelectItem value="left center">Left</SelectItem>
                                <SelectItem value="right center">Right</SelectItem>
                                <SelectItem value="top left">Top Left</SelectItem>
                                <SelectItem value="top right">Top Right</SelectItem>
                                <SelectItem value="bottom left">Bottom Left</SelectItem>
                                <SelectItem value="bottom right">Bottom Right</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Repeat</Label>
                          <Select
                            value={currentDesign.content.header?.styling?.backgroundRepeat || 'no-repeat'}
                            onValueChange={(value) => updateElementStyling('email-header', 'backgroundRepeat', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no-repeat">No Repeat</SelectItem>
                              <SelectItem value="repeat">Repeat</SelectItem>
                              <SelectItem value="repeat-x">Repeat X</SelectItem>
                              <SelectItem value="repeat-y">Repeat Y</SelectItem>
                            </SelectContent>
                          </Select>
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.sections?.greeting?.styling?.color === color
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
                          className={`h-8 w-10 p-0 ${currentDesign.content.sections?.greeting?.styling?.fontWeight === 'bold'
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
                          className={`h-8 w-10 p-0 ${currentDesign.content.sections?.greeting?.styling?.fontStyle === 'italic'
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Line Height</Label>
                        <Select
                          value={currentDesign.content.sections?.greeting?.styling?.lineHeight || '1.5'}
                          onValueChange={(value) => updateElementStyling('greeting', 'lineHeight', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1.2">Tight (1.2)</SelectItem>
                            <SelectItem value="1.4">Snug (1.4)</SelectItem>
                            <SelectItem value="1.5">Normal (1.5)</SelectItem>
                            <SelectItem value="1.6">Relaxed (1.6)</SelectItem>
                            <SelectItem value="1.8">Loose (1.8)</SelectItem>
                            <SelectItem value="2.0">Double (2.0)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Letter Spacing</Label>
                        <Select
                          value={currentDesign.content.sections?.greeting?.styling?.letterSpacing || 'normal'}
                          onValueChange={(value) => updateElementStyling('greeting', 'letterSpacing', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-0.05em">Tighter (-0.05em)</SelectItem>
                            <SelectItem value="-0.025em">Tight (-0.025em)</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="0.025em">Wide (0.025em)</SelectItem>
                            <SelectItem value="0.05em">Wider (0.05em)</SelectItem>
                            <SelectItem value="0.1em">Widest (0.1em)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Transform</Label>
                      <Select
                        value={currentDesign.content.sections?.greeting?.styling?.textTransform || 'none'}
                        onValueChange={(value) => updateElementStyling('greeting', 'textTransform', value)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="uppercase">UPPERCASE</SelectItem>
                          <SelectItem value="lowercase">lowercase</SelectItem>
                          <SelectItem value="capitalize">Capitalize</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border-t pt-4">
                      <Label className="text-xs font-medium text-gray-600 mb-3 block">Spacing Controls</Label>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.greeting?.styling?.margin || '0'}
                            onValueChange={(value) => updateElementStyling('greeting', 'margin', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                              <SelectItem value="48px">XX-Large (48px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Padding</Label>
                          <Select
                            value={currentDesign.content.sections?.greeting?.styling?.padding || '0'}
                            onValueChange={(value) => updateElementStyling('greeting', 'padding', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                              <SelectItem value="48px">XX-Large (48px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Top Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.greeting?.styling?.marginTop || '0'}
                            onValueChange={(value) => updateElementStyling('greeting', 'marginTop', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Bottom Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.greeting?.styling?.marginBottom || '16px'}
                            onValueChange={(value) => updateElementStyling('greeting', 'marginBottom', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.sections?.['custom-message']?.styling?.color === color
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
                            className={`h-8 w-10 p-0 ${currentDesign.content.sections?.['custom-message']?.styling?.textAlign === value
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Line Height</Label>
                        <Select
                          value={currentDesign.content.sections?.['custom-message']?.styling?.lineHeight || '1.6'}
                          onValueChange={(value) => updateElementStyling('custom-message', 'lineHeight', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1.2">Tight (1.2)</SelectItem>
                            <SelectItem value="1.4">Snug (1.4)</SelectItem>
                            <SelectItem value="1.5">Normal (1.5)</SelectItem>
                            <SelectItem value="1.6">Relaxed (1.6)</SelectItem>
                            <SelectItem value="1.8">Loose (1.8)</SelectItem>
                            <SelectItem value="2.0">Double (2.0)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Letter Spacing</Label>
                        <Select
                          value={currentDesign.content.sections?.['custom-message']?.styling?.letterSpacing || 'normal'}
                          onValueChange={(value) => updateElementStyling('custom-message', 'letterSpacing', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="-0.05em">Tighter (-0.05em)</SelectItem>
                            <SelectItem value="-0.025em">Tight (-0.025em)</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="0.025em">Wide (0.025em)</SelectItem>
                            <SelectItem value="0.05em">Wider (0.05em)</SelectItem>
                            <SelectItem value="0.1em">Widest (0.1em)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Transform</Label>
                      <Select
                        value={currentDesign.content.sections?.['custom-message']?.styling?.textTransform || 'none'}
                        onValueChange={(value) => updateElementStyling('custom-message', 'textTransform', value)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="uppercase">UPPERCASE</SelectItem>
                          <SelectItem value="lowercase">lowercase</SelectItem>
                          <SelectItem value="capitalize">Capitalize</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border-t pt-4">
                      <Label className="text-xs font-medium text-gray-600 mb-3 block">Spacing Controls</Label>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.['custom-message']?.styling?.margin || '24px 0'}
                            onValueChange={(value) => updateElementStyling('custom-message', 'margin', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px 0">Small (8px)</SelectItem>
                              <SelectItem value="16px 0">Medium (16px)</SelectItem>
                              <SelectItem value="24px 0">Large (24px)</SelectItem>
                              <SelectItem value="32px 0">X-Large (32px)</SelectItem>
                              <SelectItem value="48px 0">XX-Large (48px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Padding</Label>
                          <Select
                            value={currentDesign.content.sections?.['custom-message']?.styling?.padding || '0'}
                            onValueChange={(value) => updateElementStyling('custom-message', 'padding', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                              <SelectItem value="48px">XX-Large (48px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Top Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.['custom-message']?.styling?.marginTop || '24px'}
                            onValueChange={(value) => updateElementStyling('custom-message', 'marginTop', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Bottom Margin</Label>
                          <Select
                            value={currentDesign.content.sections?.['custom-message']?.styling?.marginBottom || '0'}
                            onValueChange={(value) => updateElementStyling('custom-message', 'marginBottom', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">None (0)</SelectItem>
                              <SelectItem value="8px">Small (8px)</SelectItem>
                              <SelectItem value="16px">Medium (16px)</SelectItem>
                              <SelectItem value="24px">Large (24px)</SelectItem>
                              <SelectItem value="32px">X-Large (32px)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.promoCodeStyling?.backgroundColor === color
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.promoCodeStyling?.borderColor === color
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
                            className={`w-6 h-6 rounded border-2 ${currentDesign.content.promoCodeStyling?.textColor === color
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

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Radius</Label>
                        <Select
                          value={currentDesign.content.promoCodeStyling?.borderRadius || '8px'}
                          onValueChange={(value) => handleContentUpdate({
                            promoCodeStyling: {
                              ...currentDesign.content.promoCodeStyling,
                              borderRadius: value
                            }
                          })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0px">Sharp</SelectItem>
                            <SelectItem value="4px">Small</SelectItem>
                            <SelectItem value="8px">Medium</SelectItem>
                            <SelectItem value="12px">Large</SelectItem>
                            <SelectItem value="16px">Extra Large</SelectItem>
                            <SelectItem value="9999px">Pill</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Width</Label>
                        <Select
                          value={currentDesign.content.promoCodeStyling?.borderWidth || '2px'}
                          onValueChange={(value) => handleContentUpdate({
                            promoCodeStyling: {
                              ...currentDesign.content.promoCodeStyling,
                              borderWidth: value
                            }
                          })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0px">None</SelectItem>
                            <SelectItem value="1px">Thin</SelectItem>
                            <SelectItem value="2px">Medium</SelectItem>
                            <SelectItem value="3px">Thick</SelectItem>
                            <SelectItem value="4px">Extra Thick</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Style</Label>
                      <Select
                        value={currentDesign.content.promoCodeStyling?.borderStyle || 'solid'}
                        onValueChange={(value) => handleContentUpdate({
                          promoCodeStyling: {
                            ...currentDesign.content.promoCodeStyling,
                            borderStyle: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="solid">Solid</SelectItem>
                          <SelectItem value="dashed">Dashed</SelectItem>
                          <SelectItem value="dotted">Dotted</SelectItem>
                          <SelectItem value="double">Double</SelectItem>
                          <SelectItem value="none">None</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Box Shadow</Label>
                      <Select
                        value={currentDesign.content.promoCodeStyling?.boxShadow || '0 2px 4px rgba(0,0,0,0.1)'}
                        onValueChange={(value) => handleContentUpdate({
                          promoCodeStyling: {
                            ...currentDesign.content.promoCodeStyling,
                            boxShadow: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="0 1px 2px rgba(0,0,0,0.05)">Subtle</SelectItem>
                          <SelectItem value="0 2px 4px rgba(0,0,0,0.1)">Small</SelectItem>
                          <SelectItem value="0 4px 8px rgba(0,0,0,0.12)">Medium</SelectItem>
                          <SelectItem value="0 8px 16px rgba(0,0,0,0.15)">Large</SelectItem>
                          <SelectItem value="0 12px 24px rgba(0,0,0,0.2)">Extra Large</SelectItem>
                          <SelectItem value="0 0 0 1px rgba(0,0,0,0.05)">Outline</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Padding</Label>
                      <Select
                        value={currentDesign.content.promoCodeStyling?.padding || '16px 24px'}
                        onValueChange={(value) => handleContentUpdate({
                          promoCodeStyling: {
                            ...currentDesign.content.promoCodeStyling,
                            padding: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8px 12px">Compact</SelectItem>
                          <SelectItem value="12px 16px">Small</SelectItem>
                          <SelectItem value="16px 24px">Medium</SelectItem>
                          <SelectItem value="20px 32px">Large</SelectItem>
                          <SelectItem value="24px 40px">Extra Large</SelectItem>
                        </SelectContent>
                      </Select>
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.promoCodeStyling?.labelColor === color
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.sections?.['order-button']?.styling?.backgroundColor === color
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
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.sections?.['order-button']?.styling?.color === color
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
                            className={`h-8 w-10 p-0 ${currentDesign.content.sections?.['order-button']?.styling?.alignment === value
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

                {/* Footer Settings */}
                {selectedElement === 'footer' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center">
                        <Settings className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Footer</h3>
                        <p className="text-xs text-gray-500">Email footer content</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Main Text</Label>
                      <Textarea
                        placeholder="Thank you message..."
                        value={currentDesign.content.footer?.mainText || ''}
                        onChange={(e) => handleContentUpdate({
                          footer: {
                            ...currentDesign.content.footer,
                            mainText: e.target.value
                          }
                        })}
                        className="min-h-[60px] text-sm"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Contact Text</Label>
                      <Input
                        placeholder="Questions? Contact us at..."
                        value={currentDesign.content.footer?.contactText || ''}
                        onChange={(e) => handleContentUpdate({
                          footer: {
                            ...currentDesign.content.footer,
                            contactText: e.target.value
                          }
                        })}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Copyright Text</Label>
                      <Input
                        placeholder="© 2024 Company Name"
                        value={currentDesign.content.footer?.copyrightText || ''}
                        onChange={(e) => handleContentUpdate({
                          footer: {
                            ...currentDesign.content.footer,
                            copyrightText: e.target.value
                          }
                        })}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Background Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#f8fafc', '#f1f5f9', '#e2e8f0', '#fef7f7', '#f0fdf4', '#fffbeb'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.footer?.styling?.backgroundColor === color
                                ? 'border-blue-500'
                                : 'border-gray-200'
                                }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                footer: {
                                  ...currentDesign.content.footer,
                                  styling: {
                                    ...currentDesign.content.footer?.styling,
                                    backgroundColor: color
                                  }
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Text Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#64748b', '#374151', '#1f2937', '#6b7280', '#9ca3af', '#d1d5db'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.footer?.styling?.textColor === color
                                ? 'border-blue-500'
                                : 'border-gray-200'
                                }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                footer: {
                                  ...currentDesign.content.footer,
                                  styling: {
                                    ...currentDesign.content.footer?.styling,
                                    textColor: color
                                  }
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Usage Steps Settings */}
                {selectedElement === 'usage-steps' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <Target className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Usage Steps</h3>
                        <p className="text-xs text-gray-500">How to use instructions</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Title</Label>
                      <Input
                        placeholder="How to use your promo code:"
                        value={currentDesign.content.usageSteps?.title || ''}
                        onChange={(e) => handleContentUpdate({
                          usageSteps: {
                            ...currentDesign.content.usageSteps,
                            title: e.target.value
                          }
                        })}
                        className="h-8 text-sm"
                      />
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Steps</Label>
                      {(currentDesign.content.usageSteps?.steps || []).map((step, index) => (
                        <div key={index} className="flex space-x-2 mb-2">
                          <Input
                            placeholder={`Step ${index + 1}`}
                            value={step}
                            onChange={(e) => {
                              const updatedSteps = [...(currentDesign.content.usageSteps?.steps || [])];
                              updatedSteps[index] = e.target.value;
                              handleContentUpdate({
                                usageSteps: {
                                  ...currentDesign.content.usageSteps,
                                  steps: updatedSteps
                                }
                              });
                            }}
                            className="h-8 text-sm flex-1"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const updatedSteps = [...(currentDesign.content.usageSteps?.steps || [])];
                              updatedSteps.splice(index, 1);
                              handleContentUpdate({
                                usageSteps: {
                                  ...currentDesign.content.usageSteps,
                                  steps: updatedSteps
                                }
                              });
                            }}
                            className="h-8 w-8 p-0 text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const updatedSteps = [...(currentDesign.content.usageSteps?.steps || []), 'New step'];
                          handleContentUpdate({
                            usageSteps: {
                              ...currentDesign.content.usageSteps,
                              steps: updatedSteps
                            }
                          });
                        }}
                        className="h-8 text-xs"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Step
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Background</Label>
                        <div className="grid grid-cols-2 gap-1">
                          {['linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)', 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)'].map((gradient, index) => (
                            <button
                              key={index}
                              className={`w-full h-6 rounded border-2 ${currentDesign.content.usageSteps?.styling?.backgroundColor === gradient
                                ? 'border-blue-500'
                                : 'border-gray-200'
                                }`}
                              style={{ background: gradient }}
                              onClick={() => handleContentUpdate({
                                usageSteps: {
                                  ...currentDesign.content.usageSteps,
                                  styling: {
                                    ...currentDesign.content.usageSteps?.styling,
                                    backgroundColor: gradient
                                  }
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Color</Label>
                        <div className="grid grid-cols-3 gap-1">
                          {['#93c5fd', '#86efac', '#fbbf24'].map(color => (
                            <button
                              key={color}
                              className={`w-6 h-6 rounded border-2 ${currentDesign.content.usageSteps?.styling?.borderColor === color
                                ? 'border-blue-500'
                                : 'border-gray-200'
                                }`}
                              style={{ backgroundColor: color }}
                              onClick={() => handleContentUpdate({
                                usageSteps: {
                                  ...currentDesign.content.usageSteps,
                                  styling: {
                                    ...currentDesign.content.usageSteps?.styling,
                                    borderColor: color
                                  }
                                }
                              })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Email Container Settings */}
                {selectedElement === 'email-container' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Square className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Email Container</h3>
                        <p className="text-xs text-gray-500">Overall email styling</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Max Width</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.maxWidth || '600px'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            maxWidth: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="500px">500px (Narrow)</SelectItem>
                          <SelectItem value="600px">600px (Standard)</SelectItem>
                          <SelectItem value="700px">700px (Wide)</SelectItem>
                          <SelectItem value="800px">800px (Extra Wide)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Background Color</Label>
                      <div className="grid grid-cols-4 gap-1">
                        {['#f1f5f9', '#f8fafc', '#fff', '#fef7f7', '#f0fdf4', '#fffbeb', '#f3f4f6', '#e5e7eb'].map(color => (
                          <button
                            key={color}
                            className={`w-6 h-6 rounded border-2 ${currentDesign.content.emailContainer?.backgroundColor === color
                              ? 'border-blue-500'
                              : 'border-gray-200'
                              }`}
                            style={{ backgroundColor: color }}
                            onClick={() => handleContentUpdate({
                              emailContainer: {
                                ...currentDesign.content.emailContainer,
                                backgroundColor: color
                              }
                            })}
                          />
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-1 block">Border Radius</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.borderRadius || '12px'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            borderRadius: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0px">0px (Square)</SelectItem>
                          <SelectItem value="6px">6px (Subtle)</SelectItem>
                          <SelectItem value="12px">12px (Standard)</SelectItem>
                          <SelectItem value="16px">16px (Rounded)</SelectItem>
                          <SelectItem value="24px">24px (Very Rounded)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="border-t pt-4">
                      <Label className="text-xs font-medium text-gray-600 mb-3 block">Background Image</Label>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Image URL</Label>
                        <Input
                          placeholder="https://example.com/background.jpg"
                          value={currentDesign.content.emailContainer?.backgroundImage || ''}
                          onChange={(e) => handleContentUpdate({
                            emailContainer: {
                              ...currentDesign.content.emailContainer,
                              backgroundImage: e.target.value
                            }
                          })}
                          className="h-8 text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Size</Label>
                          <Select
                            value={currentDesign.content.emailContainer?.backgroundSize || 'cover'}
                            onValueChange={(value) => handleContentUpdate({
                              emailContainer: {
                                ...currentDesign.content.emailContainer,
                                backgroundSize: value
                              }
                            })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="cover">Cover</SelectItem>
                              <SelectItem value="contain">Contain</SelectItem>
                              <SelectItem value="auto">Auto</SelectItem>
                              <SelectItem value="100% 100%">Stretch</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Position</Label>
                          <Select
                            value={currentDesign.content.emailContainer?.backgroundPosition || 'center center'}
                            onValueChange={(value) => handleContentUpdate({
                              emailContainer: {
                                ...currentDesign.content.emailContainer,
                                backgroundPosition: value
                              }
                            })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="center center">Center</SelectItem>
                              <SelectItem value="top center">Top</SelectItem>
                              <SelectItem value="bottom center">Bottom</SelectItem>
                              <SelectItem value="left center">Left</SelectItem>
                              <SelectItem value="right center">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600 mb-1 block">Repeat</Label>
                        <Select
                          value={currentDesign.content.emailContainer?.backgroundRepeat || 'no-repeat'}
                          onValueChange={(value) => handleContentUpdate({
                            emailContainer: {
                              ...currentDesign.content.emailContainer,
                              backgroundRepeat: value
                            }
                          })}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="no-repeat">No Repeat</SelectItem>
                            <SelectItem value="repeat">Repeat</SelectItem>
                            <SelectItem value="repeat-x">Repeat X</SelectItem>
                            <SelectItem value="repeat-y">Repeat Y</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Mobile Settings */}
                {selectedElement === 'mobile-settings' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <Square className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Mobile Settings</h3>
                        <p className="text-xs text-gray-500">Mobile-specific styling controls</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Mobile Container Width</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.mobileMaxWidth || '100%'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            mobileMaxWidth: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="100%">Full Width (100%)</SelectItem>
                          <SelectItem value="95%">95%</SelectItem>
                          <SelectItem value="90%">90%</SelectItem>
                          <SelectItem value="350px">350px</SelectItem>
                          <SelectItem value="320px">320px</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Mobile Padding</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.mobilePadding || '16px'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            mobilePadding: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8px">8px (Tight)</SelectItem>
                          <SelectItem value="12px">12px (Snug)</SelectItem>
                          <SelectItem value="16px">16px (Normal)</SelectItem>
                          <SelectItem value="20px">20px (Relaxed)</SelectItem>
                          <SelectItem value="24px">24px (Spacious)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Mobile Font Scale</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.mobileFontScale || '100%'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            mobileFontScale: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="85%">85% (Smaller)</SelectItem>
                          <SelectItem value="90%">90% (Small)</SelectItem>
                          <SelectItem value="100%">100% (Normal)</SelectItem>
                          <SelectItem value="110%">110% (Large)</SelectItem>
                          <SelectItem value="120%">120% (Larger)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Mobile Button Size</Label>
                      <Select
                        value={currentDesign.content.emailContainer?.mobileButtonSize || 'normal'}
                        onValueChange={(value) => handleContentUpdate({
                          emailContainer: {
                            ...currentDesign.content.emailContainer,
                            mobileButtonSize: value
                          }
                        })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="small">Small</SelectItem>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="large">Large</SelectItem>
                          <SelectItem value="full-width">Full Width</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="pt-2 border-t border-gray-200">
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Preview Tips</Label>
                      <div className="text-xs text-gray-500 space-y-1">
                        <p>• Use the mobile/desktop toggle to see both views</p>
                        <p>• Mobile styles only apply on devices &lt; 600px width</p>
                        <p>• Test with different email clients for best results</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Divider Settings */}
                {selectedElement === 'dividers' && (
                  <div className="space-y-4">
                    <div className="flex items-center space-x-2 mb-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-gray-500 to-gray-600 rounded-lg flex items-center justify-center">
                        <Minus className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">Divider Styling</h3>
                        <p className="text-xs text-gray-500">Section separator design</p>
                      </div>
                    </div>

                    <div>
                      <Label className="text-xs font-medium text-gray-600 mb-2 block">Enable Dividers</Label>
                      <Button
                        variant={currentDesign.content.dividers?.enabled ? "default" : "outline"}
                        size="sm"
                        className="w-full h-8"
                        onClick={() => handleContentUpdate({
                          dividers: {
                            ...currentDesign.content.dividers,
                            enabled: !currentDesign.content.dividers?.enabled
                          }
                        })}
                      >
                        {currentDesign.content.dividers?.enabled ? 'Enabled' : 'Disabled'}
                      </Button>
                    </div>

                    {currentDesign.content.dividers?.enabled && (
                      <>
                        <div>
                          <Label className="text-xs font-medium text-gray-600 mb-1 block">Divider Style</Label>
                          <Select
                            value={currentDesign.content.dividers?.style || 'solid'}
                            onValueChange={(value) => handleContentUpdate({
                              dividers: {
                                ...currentDesign.content.dividers,
                                style: value
                              }
                            })}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="solid">Solid</SelectItem>
                              <SelectItem value="dashed">Dashed</SelectItem>
                              <SelectItem value="dotted">Dotted</SelectItem>
                              <SelectItem value="double">Double</SelectItem>
                              <SelectItem value="groove">Groove</SelectItem>
                              <SelectItem value="ridge">Ridge</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Color</Label>
                            <div className="grid grid-cols-4 gap-1">
                              {['#e2e8f0', '#d1d5db', '#9ca3af', '#6b7280', '#dc2626', '#3b82f6', '#10b981', '#f59e0b'].map(color => (
                                <button
                                  key={color}
                                  className={`w-6 h-6 rounded border-2 ${currentDesign.content.dividers?.color === color
                                    ? 'border-blue-500'
                                    : 'border-gray-200'
                                    }`}
                                  style={{ backgroundColor: color }}
                                  onClick={() => handleContentUpdate({
                                    dividers: {
                                      ...currentDesign.content.dividers,
                                      color: color
                                    }
                                  })}
                                />
                              ))}
                            </div>
                          </div>

                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Thickness</Label>
                            <Select
                              value={currentDesign.content.dividers?.thickness || '1px'}
                              onValueChange={(value) => handleContentUpdate({
                                dividers: {
                                  ...currentDesign.content.dividers,
                                  thickness: value
                                }
                              })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1px">1px (Thin)</SelectItem>
                                <SelectItem value="2px">2px (Medium)</SelectItem>
                                <SelectItem value="3px">3px (Thick)</SelectItem>
                                <SelectItem value="4px">4px (Extra Thick)</SelectItem>
                                <SelectItem value="5px">5px (Heavy)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Spacing</Label>
                            <Select
                              value={currentDesign.content.dividers?.margin || '24px 0'}
                              onValueChange={(value) => handleContentUpdate({
                                dividers: {
                                  ...currentDesign.content.dividers,
                                  margin: value
                                }
                              })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="8px 0">Tight (8px)</SelectItem>
                                <SelectItem value="16px 0">Snug (16px)</SelectItem>
                                <SelectItem value="24px 0">Normal (24px)</SelectItem>
                                <SelectItem value="32px 0">Relaxed (32px)</SelectItem>
                                <SelectItem value="48px 0">Loose (48px)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <Label className="text-xs font-medium text-gray-600 mb-1 block">Opacity</Label>
                            <Select
                              value={currentDesign.content.dividers?.opacity || '1'}
                              onValueChange={(value) => handleContentUpdate({
                                dividers: {
                                  ...currentDesign.content.dividers,
                                  opacity: value
                                }
                              })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0.2">20%</SelectItem>
                                <SelectItem value="0.4">40%</SelectItem>
                                <SelectItem value="0.6">60%</SelectItem>
                                <SelectItem value="0.8">80%</SelectItem>
                                <SelectItem value="1">100%</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">


                {/* Add Elements Section */}
                <div>
                  <h4 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <div className="w-5 h-5 bg-gradient-to-br from-green-500 to-green-600 rounded-md flex items-center justify-center mr-2">
                      <Plus className="h-3 w-3 text-white" />
                    </div>
                    Add Elements
                  </h4>
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
                </div>

                <div className="border-t border-gray-200 pt-3 mt-4">
                  <p className="text-xs text-gray-500 mb-3 font-medium">SETTINGS & TOOLS</p>
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 border-dashed border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                    onClick={() => setSelectedElement('mobile-settings')}
                  >
                    <Square className="h-4 w-4 mr-3 text-gray-400" />
                    <span className="text-sm">📱 Mobile Settings</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Email Preview Area */}
        <div
          className="flex-1 p-8 overflow-auto"
          style={{
            background: currentDesign.content.emailContainer?.backgroundColor || 'linear-gradient(to bottom right, #f9fafb, #eff6ff)',
            backgroundImage: currentDesign.content.emailContainer?.backgroundImage ? `url(${currentDesign.content.emailContainer.backgroundImage})` : undefined,
            backgroundSize: currentDesign.content.emailContainer?.backgroundSize || 'cover',
            backgroundPosition: currentDesign.content.emailContainer?.backgroundPosition || 'center center',
            backgroundRepeat: currentDesign.content.emailContainer?.backgroundRepeat || 'no-repeat',
            backgroundAttachment: currentDesign.content.emailContainer?.backgroundAttachment || 'scroll'
          }}
        >
          <div
            className="mx-auto transition-all duration-300"
            style={{
              maxWidth: previewMode === 'mobile' ? '375px' : (currentDesign.content.emailContainer?.maxWidth || '600px'),
              transform: previewMode === 'mobile' ? 'scale(0.9)' : 'scale(1)'
            }}
          >
            {/* Preview Header */}
            <div className="mb-6 text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Email Preview
                {previewMode === 'mobile' && (
                  <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    📱 Mobile View
                  </span>
                )}
                {previewMode === 'desktop' && (
                  <span className="ml-2 inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                    🖥️ Desktop View
                  </span>
                )}
              </h3>
              <p className="text-sm text-gray-600">Real-time preview of your email campaign</p>
            </div>

            <div
              className={`bg-white overflow-hidden border border-gray-200 transform hover:shadow-2xl transition-all duration-300 cursor-pointer mx-auto ${selectedElement === 'email-container' ? 'ring-4 ring-purple-400 ring-opacity-50' : ''
                }`}
              style={{
                boxShadow: currentDesign.content.emailContainer?.boxShadow || '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                borderRadius: currentDesign.content.emailContainer?.borderRadius || '12px',
                maxWidth: previewMode === 'mobile'
                  ? currentDesign.content.emailContainer?.mobileMaxWidth || '375px'
                  : currentDesign.content.emailContainer?.maxWidth || '600px',
                transform: previewMode === 'mobile' ? 'scale(0.8)' : 'scale(1)',
                transformOrigin: 'top center'
              }}
              onClick={(e) => {
                // Only select container if clicking on the background, not child elements
                if (e.target === e.currentTarget) {
                  setSelectedElement('email-container');
                }
              }}
            >
              {/* Email Header */}
              <div
                className={`text-white cursor-pointer transition-all duration-200 relative group email-header-brand ${selectedElement === 'email-header' ? 'ring-4 ring-blue-400 ring-opacity-50' : ''
                  }`}
                style={{
                  // Force brand color regardless of any other settings
                  backgroundColor: '#F51042',
                  backgroundImage: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)',
                  backgroundSize: currentDesign.content.header?.styling?.backgroundSize || 'cover',
                  backgroundPosition: currentDesign.content.header?.styling?.backgroundPosition || 'center center',
                  backgroundRepeat: currentDesign.content.header?.styling?.backgroundRepeat || 'no-repeat',
                  backgroundAttachment: currentDesign.content.header?.styling?.backgroundAttachment || 'scroll',
                  borderRadius: currentDesign.content.header?.styling?.borderRadius ||
                    (currentDesign.content.emailContainer?.borderRadius ?
                      `${currentDesign.content.emailContainer.borderRadius} ${currentDesign.content.emailContainer.borderRadius} 0 0` :
                      '12px 12px 0 0'),
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
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === 'greeting' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
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
                    lineHeight: currentDesign.content.sections?.greeting?.styling?.lineHeight || '1.6',
                    letterSpacing: currentDesign.content.sections?.greeting?.styling?.letterSpacing || 'normal',
                    textTransform: (currentDesign.content.sections?.greeting?.styling?.textTransform || 'none') as React.CSSProperties['textTransform'],
                    margin: currentDesign.content.sections?.greeting?.styling?.margin || '0',
                    marginTop: currentDesign.content.sections?.greeting?.styling?.marginTop,
                    marginRight: currentDesign.content.sections?.greeting?.styling?.marginRight,
                    marginBottom: currentDesign.content.sections?.greeting?.styling?.marginBottom || '16px',
                    marginLeft: currentDesign.content.sections?.greeting?.styling?.marginLeft,
                    padding: currentDesign.content.sections?.greeting?.styling?.padding || '0',
                    paddingTop: currentDesign.content.sections?.greeting?.styling?.paddingTop,
                    paddingRight: currentDesign.content.sections?.greeting?.styling?.paddingRight,
                    paddingBottom: currentDesign.content.sections?.greeting?.styling?.paddingBottom,
                    paddingLeft: currentDesign.content.sections?.greeting?.styling?.paddingLeft
                  }}>
                    {currentDesign.content.sections?.greeting?.text || `Hi ${currentDesign.content.customerName || '[Customer Name]'},`}
                  </p>
                </div>

                {/* Divider */}
                {currentDesign.content.dividers?.enabled && (
                  <div
                    className={`cursor-pointer transition-all duration-200 relative group ${selectedElement === 'dividers' ? 'ring-2 ring-gray-400 bg-gray-50' : 'hover:bg-gray-50'
                      }`}
                    onClick={() => setSelectedElement('dividers')}
                    style={{
                      margin: currentDesign.content.dividers?.margin || '24px 0',
                      padding: '8px 0'
                    }}
                  >
                    {selectedElement !== 'dividers' && (
                      <div className="absolute inset-0 bg-gray-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                        <div className="bg-gray-600 text-white px-2 py-1 rounded text-xs font-medium">
                          Edit dividers
                        </div>
                      </div>
                    )}

                    <hr style={{
                      border: 'none',
                      borderTop: `${currentDesign.content.dividers?.thickness || '1px'} ${currentDesign.content.dividers?.style || 'solid'} ${currentDesign.content.dividers?.color || '#e2e8f0'}`,
                      opacity: currentDesign.content.dividers?.opacity || '1',
                      margin: '0'
                    }} />
                  </div>
                )}

                {/* Custom Message Section */}
                <div
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === 'custom-message' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
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
                    lineHeight: currentDesign.content.sections?.['custom-message']?.styling?.lineHeight || '1.7',
                    letterSpacing: currentDesign.content.sections?.['custom-message']?.styling?.letterSpacing || 'normal',
                    textTransform: (currentDesign.content.sections?.['custom-message']?.styling?.textTransform || 'none') as React.CSSProperties['textTransform'],
                    margin: currentDesign.content.sections?.['custom-message']?.styling?.margin || '24px 0',
                    marginTop: currentDesign.content.sections?.['custom-message']?.styling?.marginTop,
                    marginRight: currentDesign.content.sections?.['custom-message']?.styling?.marginRight,
                    marginBottom: currentDesign.content.sections?.['custom-message']?.styling?.marginBottom,
                    marginLeft: currentDesign.content.sections?.['custom-message']?.styling?.marginLeft,
                    padding: currentDesign.content.sections?.['custom-message']?.styling?.padding || '0',
                    paddingTop: currentDesign.content.sections?.['custom-message']?.styling?.paddingTop,
                    paddingRight: currentDesign.content.sections?.['custom-message']?.styling?.paddingRight,
                    paddingBottom: currentDesign.content.sections?.['custom-message']?.styling?.paddingBottom,
                    paddingLeft: currentDesign.content.sections?.['custom-message']?.styling?.paddingLeft
                  }} dangerouslySetInnerHTML={{
                    __html: (currentDesign.content.sections?.['custom-message']?.text || currentDesign.content.message || 'We have an exclusive offer just for you!').replace(/\n/g, '<br/>')
                  }} />
                </div>

                {/* Divider */}
                {currentDesign.content.dividers?.enabled && (
                  <div
                    className={`cursor-pointer transition-all duration-200 relative group ${selectedElement === 'dividers' ? 'ring-2 ring-gray-400 bg-gray-50' : 'hover:bg-gray-50'
                      }`}
                    onClick={() => setSelectedElement('dividers')}
                    style={{
                      margin: currentDesign.content.dividers?.margin || '24px 0',
                      padding: '8px 0'
                    }}
                  >
                    {selectedElement !== 'dividers' && (
                      <div className="absolute inset-0 bg-gray-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                        <div className="bg-gray-600 text-white px-2 py-1 rounded text-xs font-medium">
                          Edit dividers
                        </div>
                      </div>
                    )}

                    <hr style={{
                      border: 'none',
                      borderTop: `${currentDesign.content.dividers?.thickness || '1px'} ${currentDesign.content.dividers?.style || 'solid'} ${currentDesign.content.dividers?.color || '#e2e8f0'}`,
                      opacity: currentDesign.content.dividers?.opacity || '1',
                      margin: '0'
                    }} />
                  </div>
                )}

                {/* Promo Code Section */}
                <div
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === 'promo-code' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
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
                      className={`cursor-pointer transition-all duration-200 relative group ${selectedElement === 'promo-code-label' ? 'ring-2 ring-blue-400' : ''
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
                      border: `${currentDesign.content.promoCodeStyling?.borderWidth || '2px'} ${currentDesign.content.promoCodeStyling?.borderStyle || 'dashed'} ${currentDesign.content.promoCodeStyling?.borderColor || '#9ca3af'}`,
                      borderRadius: currentDesign.content.promoCodeStyling?.borderRadius || '12px',
                      padding: currentDesign.content.promoCodeStyling?.padding || '20px',
                      boxShadow: currentDesign.content.promoCodeStyling?.boxShadow || '0 2px 4px rgba(0,0,0,0.1)',
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

                {/* Divider */}
                {currentDesign.content.dividers?.enabled && (
                  <div
                    className={`cursor-pointer transition-all duration-200 relative group ${selectedElement === 'dividers' ? 'ring-2 ring-gray-400 bg-gray-50' : 'hover:bg-gray-50'
                      }`}
                    onClick={() => setSelectedElement('dividers')}
                    style={{
                      margin: currentDesign.content.dividers?.margin || '24px 0',
                      padding: '8px 0'
                    }}
                  >
                    {selectedElement !== 'dividers' && (
                      <div className="absolute inset-0 bg-gray-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                        <div className="bg-gray-600 text-white px-2 py-1 rounded text-xs font-medium">
                          Edit dividers
                        </div>
                      </div>
                    )}

                    <hr style={{
                      border: 'none',
                      borderTop: `${currentDesign.content.dividers?.thickness || '1px'} ${currentDesign.content.dividers?.style || 'solid'} ${currentDesign.content.dividers?.color || '#e2e8f0'}`,
                      opacity: currentDesign.content.dividers?.opacity || '1',
                      margin: '0'
                    }} />
                  </div>
                )}

                {/* CTA Button Section */}
                <div
                  className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === 'order-button' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  onClick={() => setSelectedElement('order-button')}
                  style={{
                    textAlign: (currentDesign.content.sections?.['order-button']?.styling?.alignment || 'center') as React.CSSProperties['textAlign'],
                    margin: '32px 0',
                    padding: '0 20px',
                    overflow: 'hidden'
                  }}
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
                      cursor: 'pointer',
                      lineHeight: '1.4',
                      textAlign: 'center',
                      wordWrap: 'break-word',
                      wordBreak: 'break-word',
                      hyphens: 'auto',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      minHeight: '48px',
                      verticalAlign: 'middle'
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
                      className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === sectionId ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
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

                {/* Usage Steps Section */}
                {currentDesign.content.usageSteps?.enabled && (
                  <div
                    className={`cursor-pointer transition-all duration-200 relative group rounded-lg p-3 -m-3 ${selectedElement === 'usage-steps' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    onClick={() => setSelectedElement('usage-steps')}
                  >
                    {selectedElement !== 'usage-steps' && (
                      <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg">
                        <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                          Edit usage steps
                        </div>
                      </div>
                    )}

                    <div style={{
                      background: currentDesign.content.usageSteps?.styling?.backgroundColor || 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                      border: `1px solid ${currentDesign.content.usageSteps?.styling?.borderColor || '#93c5fd'}`,
                      borderRadius: currentDesign.content.usageSteps?.styling?.borderRadius || '8px',
                      padding: currentDesign.content.usageSteps?.styling?.padding || '20px',
                      margin: '24px 0'
                    }}>
                      <h4 style={{
                        color: currentDesign.content.usageSteps?.styling?.titleColor || '#1d4ed8',
                        fontSize: '16px',
                        fontWeight: '600',
                        margin: '0 0 12px 0'
                      }}>
                        {currentDesign.content.usageSteps?.title || '🚀 How to use your promo code:'}
                      </h4>
                      <ol style={{
                        margin: '0',
                        paddingLeft: '20px',
                        color: currentDesign.content.usageSteps?.styling?.textColor || '#1e40af'
                      }}>
                        {(currentDesign.content.usageSteps?.steps || []).map((step, index) => (
                          <li key={index} style={{
                            margin: '6px 0',
                            fontSize: '14px'
                          }}>
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </div>
                )}

                {/* Footer */}
                <div
                  className={`mt-12 pt-6 cursor-pointer transition-all duration-200 relative group ${selectedElement === 'footer' ? 'ring-2 ring-blue-400 bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  style={{
                    backgroundColor: currentDesign.content.footer?.styling?.backgroundColor || '#f8fafc',
                    padding: currentDesign.content.footer?.styling?.padding || '24px 32px',
                    borderTop: `1px solid ${currentDesign.content.footer?.styling?.borderColor || '#e2e8f0'}`,
                    borderRadius: '0 0 12px 12px',
                    margin: '0 -40px -40px -40px'
                  }}
                  onClick={() => setSelectedElement('footer')}
                >
                  {selectedElement !== 'footer' && (
                    <div className="absolute inset-0 bg-blue-500 bg-opacity-0 group-hover:bg-opacity-5 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <div className="bg-blue-600 text-white px-2 py-1 rounded text-xs font-medium">
                        Edit footer
                      </div>
                    </div>
                  )}

                  <div style={{
                    textAlign: (currentDesign.content.footer?.styling?.textAlign || 'center') as React.CSSProperties['textAlign']
                  }}>
                    {currentDesign.content.footer?.mainText && (
                      <p style={{
                        fontSize: currentDesign.content.footer?.styling?.fontSize || '14px',
                        color: currentDesign.content.footer?.styling?.textColor || '#64748b',
                        margin: '0 0 8px 0',
                        fontWeight: '600'
                      }}>
                        {currentDesign.content.footer.mainText}
                      </p>
                    )}

                    {currentDesign.content.footer?.showContact && currentDesign.content.footer?.contactText && (
                      <p style={{
                        fontSize: currentDesign.content.footer?.styling?.fontSize || '14px',
                        color: currentDesign.content.footer?.styling?.textColor || '#64748b',
                        margin: '0 0 8px 0'
                      }}>
                        {currentDesign.content.footer.contactText.includes('@') ? (
                          <>
                            {currentDesign.content.footer.contactText.split('@')[0]}
                            <a
                              href={`mailto:${currentDesign.content.footer.contactText.split(' ').pop()}`}
                              style={{
                                color: currentDesign.content.footer?.styling?.linkColor || '#F51042',
                                textDecoration: 'none'
                              }}
                            >
                              @{currentDesign.content.footer.contactText.split('@')[1]}
                            </a>
                          </>
                        ) : (
                          currentDesign.content.footer.contactText
                        )}
                      </p>
                    )}

                    {currentDesign.content.footer?.showCopyright && currentDesign.content.footer?.copyrightText && (
                      <>
                        <div style={{
                          height: '1px',
                          background: `linear-gradient(90deg, transparent 0%, ${currentDesign.content.footer?.styling?.borderColor || '#e2e8f0'} 50%, transparent 100%)`,
                          margin: '16px 0'
                        }} />
                        <p style={{
                          fontSize: (parseInt(currentDesign.content.footer?.styling?.fontSize || '14px') - 2) + 'px',
                          color: currentDesign.content.footer?.styling?.textColor || '#64748b',
                          margin: '0',
                          opacity: 0.8
                        }}>
                          {currentDesign.content.footer.copyrightText}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Preview Controls */}
            <div className="mt-6 flex justify-center items-center space-x-4">
              {/* View Toggle */}
              <div className="flex items-center space-x-2">
                <span className="text-xs text-gray-600">View:</span>
                <div className="flex bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setPreviewMode('desktop')}
                    className={`px-3 py-1 text-xs rounded-md transition-all duration-200 flex items-center space-x-1 ${previewMode === 'desktop'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    <Settings className="h-3 w-3" />
                    <span>Desktop</span>
                  </button>
                  <button
                    onClick={() => setPreviewMode('mobile')}
                    className={`px-3 py-1 text-xs rounded-md transition-all duration-200 flex items-center space-x-1 ${previewMode === 'mobile'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                      }`}
                  >
                    <Square className="h-3 w-3" />
                    <span>Mobile</span>
                  </button>
                </div>
              </div>

              {/* Additional Controls */}

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