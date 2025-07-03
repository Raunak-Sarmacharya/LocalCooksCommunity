import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
    Move,
    Palette,
    Plus,
    Save,
    Send,
    Settings2,
    Sparkles,
    Square,
    Trash2,
    Type
} from "lucide-react";
import React, { useState } from 'react';

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
  sections: EmailSection[];
  promoCode?: string;
  promoCodeLabel?: string;
  customMessage?: string;
  greeting?: string;
  email?: string;
  recipientType?: string;
  promoCodeStyling?: {
    backgroundColor?: string;
    borderColor?: string;
    textColor?: string;
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
    };
  };
}

interface EmailSection {
  id: string;
  type: string;
  content: any;
  styling: any;
  overlay?: {
    enabled?: boolean;
    text?: string;
    styling?: {
      color?: string;
      fontSize?: string;
      fontWeight?: string;
      textAlign?: string;
      backgroundColor?: string;
      padding?: string;
      borderRadius?: string;
      textShadow?: string;
    };
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
        sections: [],
        promoCode: 'WELCOME20',
        promoCodeLabel: '🎁 Special Offer Code',
        customMessage: 'We\'re excited to share this special offer with you! Use the code below to enjoy exclusive savings on your next order.',
        greeting: 'Hello! 👋',
        email: '',
        recipientType: 'customer',
        orderButton: {
          text: '🌟 Get Started',
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
      content: type === 'text' ? 'New text content' : type === 'button' ? 'Button Text' : '',
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
      sections: [...currentDesign.content.sections, newSection]
    });
    setSelectedElement(newSection.id);
  };

  // Remove section
  const removeSection = (sectionId: string) => {
    handleContentUpdate({
      sections: currentDesign.content.sections.filter(s => s.id !== sectionId)
    });
    if (selectedElement === sectionId) {
      setSelectedElement(null);
    }
  };

  // Update element styling
  const updateElementStyling = (elementId: string, property: string, value: string) => {
    if (elementId === 'order-button') {
      handleContentUpdate({
        orderButton: {
          ...currentDesign.content.orderButton,
          styling: {
            ...currentDesign.content.orderButton?.styling,
            [property]: value
          }
        }
      });
    } else if (elementId === 'greeting') {
      // Handle greeting styling
      const greetingSection = currentDesign.content.sections.find(s => s.id === 'greeting-section');
      if (greetingSection) {
        const updatedSections = currentDesign.content.sections.map(section => 
          section.id === 'greeting-section' 
            ? { ...section, styling: { ...section.styling, [property]: value } }
            : section
        );
        handleContentUpdate({ sections: updatedSections });
      } else {
        // Create greeting section if it doesn't exist
        const newGreetingSection = {
          id: 'greeting-section',
          type: 'greeting',
          content: "Hello! 👋",
          styling: {
            fontSize: '24px',
            fontWeight: '600',
            color: '#1e293b',
            padding: '0 0 16px 0',
            [property]: value
          }
        };
        handleContentUpdate({ sections: [newGreetingSection, ...currentDesign.content.sections] });
      }
    } else if (elementId === 'custom-message') {
      // Handle custom message styling
      const customMessageSection = currentDesign.content.sections.find(s => s.id === 'custom-message-section');
      if (customMessageSection) {
        const updatedSections = currentDesign.content.sections.map(section => 
          section.id === 'custom-message-section' 
            ? { ...section, styling: { ...section.styling, [property]: value } }
            : section
        );
        handleContentUpdate({ sections: updatedSections });
      } else {
        // Create custom message section if it doesn't exist
        const newCustomMessageSection = {
          id: 'custom-message-section',
          type: 'custom-message',
          content: currentDesign.content.customMessage || '',
          styling: {
            fontSize: '16px',
            fontWeight: '400',
            color: '#374151',
            textAlign: 'left',
            [property]: value
          }
        };
        handleContentUpdate({ sections: [...currentDesign.content.sections, newCustomMessageSection] });
      }
    } else {
      const updatedSections = currentDesign.content.sections.map(section => 
        section.id === elementId 
          ? { ...section, styling: { ...section.styling, [property]: value } }
          : section
      );
      handleContentUpdate({ sections: updatedSections });
    }
  };

  // Update element content
  const updateElementContent = (elementId: string, content: string) => {
    if (elementId === 'custom-message') {
      handleContentUpdate({ customMessage: content });
      // Also ensure we have a custom message section for styling
      const customMessageSection = currentDesign.content.sections.find(s => s.id === 'custom-message-section');
      if (!customMessageSection) {
        const newCustomMessageSection = {
          id: 'custom-message-section',
          type: 'custom-message',
          content,
          styling: {
            fontSize: '16px',
            fontWeight: '400',
            color: '#374151',
            textAlign: 'left'
          }
        };
        handleContentUpdate({ sections: [...currentDesign.content.sections, newCustomMessageSection] });
      }
    } else if (elementId === 'promo-code') {
      handleContentUpdate({ promoCode: content });
    } else if (elementId === 'promo-code-label') {
      handleContentUpdate({ promoCodeLabel: content });
    } else if (elementId === 'customer-email') {
      handleContentUpdate({ email: content });
    } else if (elementId === 'greeting') {
      // Store greeting in a custom section for now
      const greetingSection = currentDesign.content.sections.find(s => s.id === 'greeting-section');
      if (greetingSection) {
        const updatedSections = currentDesign.content.sections.map(section => 
          section.id === 'greeting-section' 
            ? { ...section, content }
            : section
        );
        handleContentUpdate({ sections: updatedSections });
      } else {
        // Create greeting section if it doesn't exist
        const newGreetingSection = {
          id: 'greeting-section',
          type: 'greeting',
          content,
          styling: {
            fontSize: '24px',
            fontWeight: '600',
            color: '#1e293b',
            padding: '0 0 16px 0'
          }
        };
        handleContentUpdate({ sections: [newGreetingSection, ...currentDesign.content.sections] });
      }
    } else if (elementId === 'order-button') {
      handleContentUpdate({
        orderButton: {
          ...currentDesign.content.orderButton,
          text: content
        }
      });
    } else {
      const updatedSections = currentDesign.content.sections.map(section => 
        section.id === elementId 
          ? { ...section, content }
          : section
      );
      handleContentUpdate({ sections: updatedSections });
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

    if (!currentDesign.content.customMessage || currentDesign.content.customMessage.length < 10) {
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
          customMessage: currentDesign.content.customMessage,
          greeting: currentDesign.content.greeting,
          designSystem: currentDesign.designSystem,
          isPremium: true,
          sections: currentDesign.content.sections,
          orderButton: currentDesign.content.orderButton,
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
    <div className="min-h-screen bg-gray-50">
      {/* Top Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg">
              <Send className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Email Campaign Manager</h1>
              <p className="text-sm text-gray-600">Send customized emails to customers and chefs</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Button variant="outline" size="sm" className="h-9 px-4">
              <Save className="h-4 w-4 mr-2" />
              Save Template
            </Button>

            <Button 
              onClick={handleSendPromoEmail}
              disabled={isSending || !currentDesign.content.email}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white h-9 px-4"
            >
              {isSending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
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
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-100px)]">
        {/* Left Sidebar - Design Tools */}
        <div className="w-80 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Email Settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center text-gray-900">
                  <Settings2 className="h-4 w-4 mr-2" />
                  Email Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="recipientType" className="text-sm font-medium text-gray-700">Recipient Type</Label>
                  <Select
                    value={currentDesign.content.recipientType || 'customer'}
                    onValueChange={(value) => handleContentUpdate({ recipientType: value })}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select recipient type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="customer">Customer</SelectItem>
                      <SelectItem value="chef">Chef/Cook</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">Recipient Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="recipient@example.com"
                    value={currentDesign.content.email || ''}
                    onChange={(e) => updateElementContent('customer-email', e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="subject" className="text-sm font-medium text-gray-700">Subject Line</Label>
                  <Input
                    id="subject"
                    placeholder="Your custom subject line"
                    value={currentDesign.content.subject}
                    onChange={(e) => handleContentUpdate({ subject: e.target.value })}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="previewText" className="text-sm font-medium text-gray-700">Preview Text</Label>
                  <Input
                    id="previewText"
                    placeholder="Email preview text"
                    value={currentDesign.content.previewText}
                    onChange={(e) => handleContentUpdate({ previewText: e.target.value })}
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Shown in email client previews</p>
                </div>
              </CardContent>
            </Card>

            {/* Element Properties - Enhanced */}
            {selectedElement && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center text-gray-900">
                    <Palette className="h-4 w-4 mr-2" />
                    Element Editor
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Editing: {selectedElement.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Email Header Properties */}
                  {selectedElement === 'email-header' && (
                    <>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Company Name (Optional)</Label>
                        <Input
                          placeholder="Local Cooks"
                          value={currentDesign.content.header?.title || ''}
                          onChange={(e) => handleContentUpdate({
                            header: {
                              ...currentDesign.content.header,
                              title: e.target.value
                            }
                          })}
                          className="mt-1"
                        />
                      </div>
                      
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Tagline (Optional)</Label>
                        <Input
                          placeholder="Premium Quality Food"
                          value={currentDesign.content.header?.subtitle || ''}
                          onChange={(e) => handleContentUpdate({
                            header: {
                              ...currentDesign.content.header,
                              subtitle: e.target.value
                            }
                          })}
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label className="text-sm font-medium text-gray-700">Header Background</Label>
                        <Input
                          type="color"
                          value={currentDesign.content.header?.styling?.backgroundColor?.includes('gradient') ? '#F51042' : (currentDesign.content.header?.styling?.backgroundColor || '#F51042')}
                          onChange={(e) => handleContentUpdate({
                            header: {
                              ...currentDesign.content.header,
                              styling: {
                                ...currentDesign.content.header?.styling,
                                backgroundColor: e.target.value
                              }
                            }
                          })}
                          className="mt-1 h-8"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                          <Input
                            type="color"
                            value={currentDesign.content.header?.styling?.titleColor || '#ffffff'}
                            onChange={(e) => handleContentUpdate({
                              header: {
                                ...currentDesign.content.header,
                                styling: {
                                  ...currentDesign.content.header?.styling,
                                  titleColor: e.target.value,
                                  subtitleColor: e.target.value
                                }
                              }
                            })}
                            className="mt-1 h-8"
                          />
                        </div>

                        <div>
                          <Label className="text-sm font-medium text-gray-700">Text Size</Label>
                          <Select
                            value={currentDesign.content.header?.styling?.titleFontSize || '32px'}
                            onValueChange={(value) => handleContentUpdate({
                              header: {
                                ...currentDesign.content.header,
                                styling: {
                                  ...currentDesign.content.header?.styling,
                                  titleFontSize: value
                                }
                              }
                            })}
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="24px">24px</SelectItem>
                              <SelectItem value="28px">28px</SelectItem>
                              <SelectItem value="32px">32px</SelectItem>
                              <SelectItem value="36px">36px</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div>
                        <Label className="text-sm font-medium text-gray-700">Brand Color Presets</Label>
                        <div className="grid grid-cols-3 gap-2 mt-2">
                          <button
                            className="h-8 rounded border hover:border-gray-400 text-xs text-white"
                            style={{ background: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' }}
                            onClick={() => handleContentUpdate({
                              header: {
                                ...currentDesign.content.header,
                                styling: {
                                  ...currentDesign.content.header?.styling,
                                  backgroundColor: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)'
                                }
                              }
                            })}
                          >
                            Brand Red
                          </button>
                          <button
                            className="h-8 rounded border hover:border-gray-400 text-xs text-white"
                            style={{ background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' }}
                            onClick={() => handleContentUpdate({
                              header: {
                                ...currentDesign.content.header,
                                styling: {
                                  ...currentDesign.content.header?.styling,
                                  backgroundColor: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)'
                                }
                              }
                            })}
                          >
                            Professional
                          </button>
                          <button
                            className="h-8 rounded border hover:border-gray-400 text-xs text-white"
                            style={{ background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)' }}
                            onClick={() => handleContentUpdate({
                              header: {
                                ...currentDesign.content.header,
                                styling: {
                                  ...currentDesign.content.header?.styling,
                                  backgroundColor: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)'
                                }
                              }
                            })}
                          >
                            Success
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Promo Code Section Styling */}
                  {selectedElement === 'promo-code' && (
                    <>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Promo Code</Label>
                        <Input
                          placeholder="SAVE20"
                          value={currentDesign.content.promoCode || ''}
                          onChange={(e) => updateElementContent('promo-code', e.target.value.toUpperCase())}
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Section Background Color</Label>
                        <Input
                          type="color"
                          value="#f0fdf4"
                          onChange={(e) => {
                            // Update promo code section background through custom styling
                            handleContentUpdate({
                              ...currentDesign.content,
                              promoCodeStyling: {
                                backgroundColor: e.target.value
                              }
                            });
                          }}
                          className="mt-1 h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Border Color</Label>
                        <Input
                          type="color"
                          value="#16a34a"
                          onChange={(e) => {
                            handleContentUpdate({
                              ...currentDesign.content,
                              promoCodeStyling: {
                                ...currentDesign.content.promoCodeStyling,
                                borderColor: e.target.value
                              }
                            });
                          }}
                          className="mt-1 h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                        <Input
                          type="color"
                          value="#16a34a"
                          onChange={(e) => {
                            handleContentUpdate({
                              ...currentDesign.content,
                              promoCodeStyling: {
                                ...currentDesign.content.promoCodeStyling,
                                textColor: e.target.value
                              }
                            });
                          }}
                          className="mt-1 h-8"
                        />
                      </div>
                    </>
                  )}

                  {/* Promo Code Label Styling */}
                  {selectedElement === 'promo-code-label' && (
                    <>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Label Text</Label>
                        <Input
                          placeholder="🎁 Special Offer Code"
                          value={currentDesign.content.promoCodeLabel || ''}
                          onChange={(e) => updateElementContent('promo-code-label', e.target.value)}
                          className="mt-1"
                        />
                      </div>
                      
                      {/* Text Formatting Controls */}
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Text Formatting</Label>
                        <div className="grid grid-cols-3 gap-2 mt-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => updateElementStyling('promo-code-label', 'fontWeight', 
                              currentDesign.content.sections.find(s => s.id === 'promo-code-label-section')?.styling?.fontWeight === '700' ? '400' : '700'
                            )}
                          >
                            <strong>B</strong>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-8"
                            onClick={() => updateElementStyling('promo-code-label', 'fontStyle', 
                              currentDesign.content.sections.find(s => s.id === 'promo-code-label-section')?.styling?.fontStyle === 'italic' ? 'normal' : 'italic'
                            )}
                          >
                            <em>I</em>
                          </Button>
                          <Select
                            value={currentDesign.content.sections.find(s => s.id === 'promo-code-label-section')?.styling?.textAlign || 'center'}
                            onValueChange={(value) => updateElementStyling('promo-code-label', 'textAlign', value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">Left</SelectItem>
                              <SelectItem value="center">Center</SelectItem>
                              <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Content Editor for text elements and buttons */}
                  {(selectedElement === 'custom-message' || selectedElement === 'order-button' || selectedElement === 'greeting' ||
                    selectedElement.startsWith('section-')) && (
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Content</Label>
                      {selectedElement === 'custom-message' ? (
                        <Textarea
                          placeholder="Enter your email message..."
                          value={currentDesign.content.customMessage || ''}
                          onChange={(e) => updateElementContent('custom-message', e.target.value)}
                          className="mt-1"
                          rows={4}
                        />
                      ) : selectedElement === 'order-button' ? (
                        <>
                          <Input
                            placeholder="Call-to-action text"
                            value={currentDesign.content.orderButton?.text || ''}
                            onChange={(e) => updateElementContent('order-button', e.target.value)}
                            className="mt-1 mb-2"
                          />
                          <Label className="text-sm font-medium text-gray-700">Button Link</Label>
                          <Input
                            placeholder="https://localcooks.com"
                            value={currentDesign.content.orderButton?.url || ''}
                            onChange={(e) => handleContentUpdate({
                              orderButton: {
                                ...currentDesign.content.orderButton,
                                url: e.target.value
                              }
                            })}
                            className="mt-1"
                          />
                        </>
                      ) : selectedElement === 'greeting' ? (
                        <Input
                          placeholder="Hello! 👋"
                          value={currentDesign.content.sections.find(s => s.id === 'greeting-section')?.content || "Hello! 👋"}
                          onChange={(e) => updateElementContent('greeting', e.target.value)}
                          className="mt-1"
                        />
                      ) : selectedElement.startsWith('section-') && currentDesign.content.sections.find(s => s.id === selectedElement)?.type === 'button' ? (
                        <>
                          <Input
                            placeholder="Button text"
                            value={currentDesign.content.sections.find(s => s.id === selectedElement)?.content || ''}
                            onChange={(e) => updateElementContent(selectedElement, e.target.value)}
                            className="mt-1 mb-2"
                          />
                          <Label className="text-sm font-medium text-gray-700">Button URL</Label>
                          <Input
                            placeholder="https://example.com"
                            value={currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.url || ''}
                            onChange={(e) => updateElementStyling(selectedElement, 'url', e.target.value)}
                            className="mt-1"
                          />
                        </>
                      ) : (
                        <Textarea
                          placeholder="Enter content..."
                          value={currentDesign.content.sections.find(s => s.id === selectedElement)?.content || ''}
                          onChange={(e) => updateElementContent(selectedElement, e.target.value)}
                          className="mt-1"
                          rows={3}
                        />
                      )}
                    </div>
                  )}

                  {/* Text Formatting Controls for all text elements */}
                  {(selectedElement === 'custom-message' || selectedElement === 'greeting' || 
                    (selectedElement.startsWith('section-') && currentDesign.content.sections.find(s => s.id === selectedElement)?.type === 'text')) && (
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Text Formatting</Label>
                      <div className="grid grid-cols-4 gap-2 mt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            const currentWeight = selectedElement === 'custom-message' 
                              ? currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.fontWeight
                              : selectedElement === 'greeting'
                              ? currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.fontWeight
                              : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.fontWeight;
                            updateElementStyling(selectedElement, 'fontWeight', currentWeight === '700' ? '400' : '700');
                          }}
                        >
                          <strong>B</strong>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            const currentStyle = selectedElement === 'custom-message' 
                              ? currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.fontStyle
                              : selectedElement === 'greeting'
                              ? currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.fontStyle
                              : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.fontStyle;
                            updateElementStyling(selectedElement, 'fontStyle', currentStyle === 'italic' ? 'normal' : 'italic');
                          }}
                        >
                          <em>I</em>
                        </Button>
                        <Select
                          value={
                            selectedElement === 'custom-message' 
                              ? currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.textAlign || 'left'
                              : selectedElement === 'greeting'
                              ? currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.textAlign || 'left'
                              : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.textAlign || 'left'
                          }
                          onValueChange={(value) => updateElementStyling(selectedElement, 'textAlign', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="left">Left</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="right">Right</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={
                            selectedElement === 'custom-message' 
                              ? currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.fontSize || '16px'
                              : selectedElement === 'greeting'
                              ? currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.fontSize || '24px'
                              : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.fontSize || '16px'
                          }
                          onValueChange={(value) => updateElementStyling(selectedElement, 'fontSize', value)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="12px">12px</SelectItem>
                            <SelectItem value="14px">14px</SelectItem>
                            <SelectItem value="16px">16px</SelectItem>
                            <SelectItem value="18px">18px</SelectItem>
                            <SelectItem value="20px">20px</SelectItem>
                            <SelectItem value="24px">24px</SelectItem>
                            <SelectItem value="28px">28px</SelectItem>
                            <SelectItem value="32px">32px</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Color Customization - Background only for buttons */}
                  {(selectedElement === 'order-button' || (selectedElement?.startsWith('section-') && currentDesign.content.sections.find(s => s.id === selectedElement)?.type === 'button')) && (
                    <>
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Button Background</Label>
                        <Input
                          type="color"
                          value={
                          selectedElement === 'order-button' 
                            ? currentDesign.content.orderButton?.styling?.backgroundColor || '#F51042'
                            : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.backgroundColor || '#F51042'
                        }
                          onChange={(e) => updateElementStyling(selectedElement, 'backgroundColor', e.target.value)}
                          className="mt-1 h-8"
                        />
                      </div>
                    </>
                  )}

                  {/* Text Color - Available for all elements except email-header */}
                  {selectedElement !== 'email-header' && selectedElement !== 'promo-code' && selectedElement !== 'promo-code-label' && (
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                        <Input
                          type="color"
                          value={
                          selectedElement === 'order-button' 
                            ? currentDesign.content.orderButton?.styling?.color || '#ffffff'
                            : selectedElement === 'greeting'
                            ? currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.color || '#1e293b'
                            : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.color || '#374151'
                        }
                          onChange={(e) => updateElementStyling(selectedElement, 'color', e.target.value)}
                        className="mt-1 h-8"
                      />
                    </div>
                  )}

                  {/* Quick Colors - Only for buttons */}
                  {(selectedElement === 'order-button' || (selectedElement?.startsWith('section-') && currentDesign.content.sections.find(s => s.id === selectedElement)?.type === 'button')) && (
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Button Styles</Label>
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        {[
                          { color: '#F51042', name: 'Brand' },
                          { color: '#16a34a', name: 'Success' },
                          { color: '#2563eb', name: 'Info' },
                          { color: '#f59e0b', name: 'Warning' },
                          { color: '#dc2626', name: 'Alert' },
                          { color: '#7c3aed', name: 'Purple' }
                        ].map(({ color, name }) => (
                          <button
                            key={color}
                            className="h-8 rounded border-2 border-gray-200 hover:border-gray-400 text-xs text-white font-medium"
                            style={{ backgroundColor: color }}
                            onClick={() => updateElementStyling(selectedElement, 'backgroundColor', color)}
                            title={name}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Add Elements */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center text-gray-900">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Elements
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-xs h-8"
                  onClick={() => addSection('text')}
                >
                  <Type className="h-3 w-3 mr-2" />
                  Add Text Block
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-xs h-8"
                  onClick={() => addSection('button')}
                >
                  <Square className="h-3 w-3 mr-2" />
                  Add Button
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Preview Area */}
        <div className="flex-1 bg-gray-100 overflow-hidden">
          <div className="h-full flex items-center justify-center p-6">
            <div className="bg-white shadow-xl max-w-2xl w-full rounded-xl overflow-hidden" style={{ minHeight: '80vh' }}>
              {/* Email Header - Customizable Brand Header */}
              <div 
                className={`text-white cursor-pointer transition-all duration-200 ${selectedElement === 'email-header' ? 'ring-4 ring-blue-400' : ''}`}
                style={{ 
                  background: currentDesign.content.header?.styling?.backgroundColor || 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)',
                  padding: currentDesign.content.header?.styling?.padding || '24px 32px',
                  textAlign: (currentDesign.content.header?.styling?.textAlign || 'center') as React.CSSProperties['textAlign']
                }}
                onClick={() => setSelectedElement('email-header')}
              >
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
                {/* Optional custom header title/subtitle */}
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
              <div className="p-8 space-y-6">
                                  {/* Greeting */}
                  <div 
                    className={`cursor-pointer transition-all duration-200 ${
                      selectedElement === 'greeting' ? 'ring-2 ring-blue-500 rounded-lg p-1' : ''
                    }`}
                    onClick={() => setSelectedElement('greeting')}
                  >
                    <h2 style={{ 
                      fontSize: currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.fontSize || '24px',
                      fontWeight: currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.fontWeight || '600',
                      color: currentDesign.content.sections.find(s => s.id === 'greeting-section')?.styling?.color || '#1e293b',
                      margin: '0 0 16px 0'
                    }}>
                      {currentDesign.content.sections.find(s => s.id === 'greeting-section')?.content || "Hello! 👋"}
                    </h2>
                  </div>

                {/* Custom Message */}
                {currentDesign.content.customMessage ? (
                  <div 
                    className={`cursor-pointer transition-all duration-200 ${
                      selectedElement === 'custom-message' ? 'ring-2 ring-blue-500 rounded-lg p-1' : ''
                    }`}
                    style={{
                      fontFamily: 'Nunito, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                      fontSize: currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.fontSize || '16px',
                      fontWeight: currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.fontWeight || '400',
                      textAlign: (currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.textAlign || 'left') as React.CSSProperties['textAlign'],
                      lineHeight: '1.6',
                      color: currentDesign.content.sections.find(s => s.id === 'custom-message-section')?.styling?.color || '#374151',
                      whiteSpace: 'pre-line',
                      padding: selectedElement === 'custom-message' ? '0' : '8px 0'
                    }}
                    onClick={() => setSelectedElement('custom-message')}
                  >
                    {currentDesign.content.customMessage}
                  </div>
                ) : (
                  <div 
                    className={`p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded text-center cursor-pointer transition-all duration-200 ${
                      selectedElement === 'custom-message' ? 'ring-2 ring-blue-500' : ''
                    }`}
                    onClick={() => setSelectedElement('custom-message')}
                  >
                    <p className="text-gray-500">Click to add your custom message</p>
                  </div>
                )}

                {/* Promo Code Section */}
                {currentDesign.content.promoCode ? (
                  <div 
                    className={`cursor-pointer transition-all duration-200 ${
                      selectedElement === 'promo-code' ? 'ring-2 ring-blue-500' : ''
                    }`}
                    style={{
                      background: currentDesign.content.promoCodeStyling?.backgroundColor || 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                      border: `2px dashed ${currentDesign.content.promoCodeStyling?.borderColor || '#16a34a'}`,
                      borderRadius: '12px',
                      padding: '24px',
                      textAlign: 'center',
                      margin: '24px 0'
                    }}
                    onClick={() => setSelectedElement('promo-code')}
                  >
                    <div 
                      className={`cursor-pointer transition-all duration-200 ${
                        selectedElement === 'promo-code-label' ? 'ring-2 ring-purple-500 rounded p-1' : ''
                      }`}
                      style={{
                        fontSize: '14px',
                        fontWeight: '600',
                        color: currentDesign.content.promoCodeStyling?.textColor || '#15803d',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        marginBottom: '8px'
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement('promo-code-label');
                      }}
                    >
                      {currentDesign.content.promoCodeLabel || '🎁 Special Offer Code'}
                    </div>
                    <div style={{
                      fontFamily: '"Courier New", monospace',
                      fontSize: '28px',
                      fontWeight: '800',
                      color: currentDesign.content.promoCodeStyling?.textColor || '#16a34a',
                      letterSpacing: '2px',
                      margin: '8px 0'
                    }}>
                      {currentDesign.content.promoCode}
                    </div>
                  </div>
                ) : (
                  <div 
                    className={`bg-gray-50 border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer transition-all duration-200 ${
                      selectedElement === 'promo-code' ? 'ring-2 ring-blue-500' : ''
                    }`}
                    onClick={() => setSelectedElement('promo-code')}
                  >
                    <p className="text-gray-500">Click to add promo code</p>
                  </div>
                )}

                {/* Custom Sections */}
                {currentDesign.content.sections.map((section) => (
                  <div
                    key={section.id}
                    className={`cursor-pointer transition-all duration-200 ${
                      selectedElement === section.id ? 'ring-2 ring-blue-500 rounded' : ''
                    }`}
                    onClick={() => setSelectedElement(section.id)}
                    style={{ margin: '16px 0' }}
                  >
                    {section.type === 'text' && (
                      <div style={{ 
                        color: section.styling?.color || '#374151',
                        textAlign: section.styling?.textAlign || 'left',
                        fontSize: section.styling?.fontSize || '16px',
                        fontWeight: section.styling?.fontWeight || '400',
                        background: section.styling?.backgroundColor || 'transparent',
                        borderRadius: section.styling?.backgroundColor && section.styling?.backgroundColor !== 'transparent' 
                          ? '8px' : '0',
                        padding: section.styling?.padding || '8px 0',
                        lineHeight: '1.6'
                      }}>
                        {section.content || 'Text content'}
                      </div>
                    )}
                    
                    {section.type === 'button' && (
                      <div style={{ textAlign: section.styling?.textAlign || 'center' }}>
                        <a 
                          href={section.styling?.url || '#'}
                          style={{
                            display: 'inline-block',
                            backgroundColor: section.styling?.backgroundColor || '#F51042',
                            color: section.styling?.color || '#ffffff',
                            border: 'none',
                            borderRadius: section.styling?.borderRadius || '8px',
                            fontSize: section.styling?.fontSize || '16px',
                            fontWeight: section.styling?.fontWeight || '600',
                            padding: section.styling?.padding || '12px 24px',
                            cursor: 'pointer',
                            textDecoration: 'none'
                          }}
                        >
                          {section.content || 'Button'}
                        </a>
                      </div>
                    )}
                  </div>
                ))}

                {/* Order Button */}
                <div 
                  className={`transition-all duration-200 ${
                    selectedElement === 'order-button' ? 'ring-2 ring-blue-500 rounded' : ''
                  }`}
                  style={{ 
                    textAlign: (currentDesign.content.orderButton?.styling?.textAlign || 'center') as React.CSSProperties['textAlign'], 
                    margin: '32px 0' 
                  }}
                  onClick={() => setSelectedElement('order-button')}
                >
                  <div 
                    className="inline-block cursor-pointer transition-colors"
                    style={{ 
                      background: currentDesign.content.orderButton?.styling?.backgroundColor || 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)',
                      color: currentDesign.content.orderButton?.styling?.color || '#ffffff',
                      padding: currentDesign.content.orderButton?.styling?.padding || '14px 28px',
                      borderRadius: currentDesign.content.orderButton?.styling?.borderRadius || '8px',
                      fontWeight: currentDesign.content.orderButton?.styling?.fontWeight || '600',
                      fontSize: currentDesign.content.orderButton?.styling?.fontSize || '16px',
                      textDecoration: 'none',
                      boxShadow: '0 2px 8px hsla(347, 91%, 51%, 0.3)'
                    }}
                  >
                    {currentDesign.content.orderButton?.text || '🌟 Start Shopping Now'}
                  </div>
                </div>
              </div>

              {/* Email Footer - Fixed */}
              <div style={{ 
                background: '#f8fafc',
                padding: '24px 32px',
                textAlign: 'center',
                borderTop: '1px solid #e2e8f0'
              }}>
                <p style={{
                  fontSize: '14px',
                  color: '#64748b',
                  margin: '0 0 8px 0'
                }}>
                  Thank you for being part of the <strong>Local Cooks</strong> community!
                </p>
                <p style={{
                  fontSize: '13px',
                  color: '#94a3b8',
                  margin: '0'
                }}>
                  <a href="#" style={{ color: 'hsl(347, 91%, 51%)', textDecoration: 'none' }}>Support</a> • 
                  <a href="#" style={{ color: 'hsl(347, 91%, 51%)', textDecoration: 'none' }}> Privacy Policy</a>
                </p>
                <div style={{
                  height: '1px',
                  background: 'linear-gradient(90deg, transparent 0%, #e2e8f0 50%, transparent 100%)',
                  margin: '16px 0'
                }}></div>
                <p style={{
                  fontSize: '13px',
                  color: '#94a3b8',
                  margin: '0'
                }}>
                  © {new Date().getFullYear()} Local Cooks Community
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 