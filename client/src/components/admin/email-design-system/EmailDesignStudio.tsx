import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
    Image as ImageIcon,
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
      name: 'Premium Email Design',
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
        tags: ['promo', 'email'],
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
    } else if (elementId === 'promo-code') {
      handleContentUpdate({ promoCode: content });
    } else if (elementId === 'customer-email') {
      handleContentUpdate({ email: content });
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

  // Send test email
  const handleSendTestEmail = async () => {
    if (!currentDesign.content.email) {
      toast({
        title: "Email Required",
        description: "Please enter a test email address",
        variant: "destructive"
      });
      return;
    }

    setIsSending(true);
    try {
      const response = await fetch('/api/send-promo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: currentDesign.content.email,
          promoCode: currentDesign.content.promoCode,
          customMessage: currentDesign.content.customMessage,
          designSystem: currentDesign.designSystem,
          isPremium: true,
          sections: currentDesign.content.sections,
          orderButton: currentDesign.content.orderButton,
          subject: currentDesign.content.subject,
          previewText: currentDesign.content.previewText
        })
      });

      if (response.ok) {
        toast({
          title: "✅ Email Sent!",
          description: `Test email sent to ${currentDesign.content.email}`
        });
      } else {
        throw new Error('Failed to send email');
      }
    } catch (error) {
      toast({
        title: "Send Failed",
        description: "Could not send test email. Please try again.",
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
            <div className="p-2 bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg">
              <Sparkles className="h-5 w-5 text-purple-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Premium Email Designer</h1>
              <p className="text-sm text-gray-600">Create stunning promo emails with ease</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <Button variant="outline" size="sm" className="h-9 px-4">
              <Save className="h-4 w-4 mr-2" />
              Save Design
            </Button>

            <Button 
              onClick={handleSendTestEmail}
              disabled={isSending || !currentDesign.content.email}
              className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white h-9 px-4"
            >
              {isSending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Sending...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Send Test Email
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
                  Email Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="email" className="text-sm font-medium text-gray-700">Customer Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="customer@example.com"
                    value={currentDesign.content.email || ''}
                    onChange={(e) => updateElementContent('customer-email', e.target.value)}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="subject" className="text-sm font-medium text-gray-700">Subject Line</Label>
                  <Input
                    id="subject"
                    placeholder="Special Offer Just for You!"
                    value={currentDesign.content.subject}
                    onChange={(e) => handleContentUpdate({ subject: e.target.value })}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="previewText" className="text-sm font-medium text-gray-700">Preview Text</Label>
                  <Input
                    id="previewText"
                    placeholder="Exclusive promo code inside"
                    value={currentDesign.content.previewText}
                    onChange={(e) => handleContentUpdate({ previewText: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Element Properties */}
            {selectedElement && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center text-gray-900">
                    <Palette className="h-4 w-4 mr-2" />
                    Element Properties
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Editing: {selectedElement}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Content Editor */}
                  {(selectedElement === 'custom-message' || selectedElement === 'promo-code' || 
                    selectedElement.startsWith('section-') || selectedElement === 'order-button') && (
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Content</Label>
                      {selectedElement === 'custom-message' ? (
                        <Textarea
                          placeholder="Enter your custom message..."
                          value={currentDesign.content.customMessage || ''}
                          onChange={(e) => updateElementContent('custom-message', e.target.value)}
                          className="mt-1"
                          rows={3}
                        />
                      ) : selectedElement === 'promo-code' ? (
                        <Input
                          placeholder="PROMO20"
                          value={currentDesign.content.promoCode || ''}
                          onChange={(e) => updateElementContent('promo-code', e.target.value.toUpperCase())}
                          className="mt-1"
                        />
                      ) : selectedElement === 'order-button' ? (
                        <Input
                          placeholder="Button text"
                          value={currentDesign.content.orderButton?.text || ''}
                          onChange={(e) => updateElementContent('order-button', e.target.value)}
                          className="mt-1"
                        />
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

                  {/* Quick Color Options */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Quick Colors</Label>
                    <div className="grid grid-cols-6 gap-2 mt-1">
                      {['#F51042', '#16a34a', '#2563eb', '#f59e0b', '#dc2626', '#7c3aed'].map(color => (
                        <button
                          key={color}
                          className="w-8 h-8 rounded border-2 border-gray-200 hover:border-gray-400"
                          style={{ backgroundColor: color }}
                          onClick={() => {
                            if (selectedElement === 'order-button' || selectedElement.startsWith('section-')) {
                              updateElementStyling(selectedElement, 'backgroundColor', color);
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Element Styling */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Font Size</Label>
                      <Select
                        value={
                          selectedElement === 'order-button' 
                            ? currentDesign.content.orderButton?.styling?.fontSize || '16px'
                            : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.fontSize || '16px'
                        }
                        onValueChange={(value) => updateElementStyling(selectedElement, 'fontSize', value)}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="12px">12px</SelectItem>
                          <SelectItem value="14px">14px</SelectItem>
                          <SelectItem value="16px">16px</SelectItem>
                          <SelectItem value="18px">18px</SelectItem>
                          <SelectItem value="20px">20px</SelectItem>
                          <SelectItem value="24px">24px</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-gray-700">Text Align</Label>
                      <Select
                        value={
                          selectedElement === 'order-button' 
                            ? currentDesign.content.orderButton?.styling?.textAlign || 'center'
                            : currentDesign.content.sections.find(s => s.id === selectedElement)?.styling?.textAlign || 'left'
                        }
                        onValueChange={(value) => updateElementStyling(selectedElement, 'textAlign', value)}
                      >
                        <SelectTrigger className="h-8">
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

                  {/* Remove Section Button */}
                  {selectedElement.startsWith('section-') && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => removeSection(selectedElement)}
                      className="w-full text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove Element
                    </Button>
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
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-xs h-8"
                  onClick={() => addSection('image')}
                >
                  <ImageIcon className="h-3 w-3 mr-2" />
                  Add Image
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full justify-start text-xs h-8"
                  onClick={() => addSection('divider')}
                >
                  <Move className="h-3 w-3 mr-2" />
                  Add Divider
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Main Preview Area */}
        <div className="flex-1 bg-gray-100 overflow-hidden">
          <div className="h-full flex items-center justify-center p-6">
            <div className="bg-white shadow-xl max-w-2xl w-full rounded-xl overflow-hidden" style={{ minHeight: '80vh' }}>
              {/* Email Header - Fixed Brand Header */}
              <div 
                className={`text-white ${selectedElement === 'email-header' ? 'ring-4 ring-blue-400' : ''}`}
                style={{ 
                  background: 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)',
                  padding: '24px 32px',
                  textAlign: 'center'
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
                    fontSize: '24px',
                    fontWeight: '600',
                    color: '#1e293b',
                    margin: '0 0 16px 0'
                  }}>
                    Hello! 👋
                  </h2>
                </div>

                {/* Custom Message */}
                {currentDesign.content.customMessage ? (
                  <div 
                    className={`cursor-pointer transition-all duration-200 ${
                      selectedElement === 'custom-message' ? 'ring-2 ring-blue-500' : ''
                    }`}
                    style={{
                      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
                      borderLeft: '4px solid hsl(347, 91%, 51%)',
                      borderRadius: '8px',
                      padding: '20px',
                      fontSize: '16px',
                      lineHeight: '1.6',
                      color: '#475569',
                      whiteSpace: 'pre-line'
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
                      background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
                      border: '2px dashed #16a34a',
                      borderRadius: '12px',
                      padding: '24px',
                      textAlign: 'center',
                      margin: '24px 0'
                    }}
                    onClick={() => setSelectedElement('promo-code')}
                  >
                    <div style={{
                      fontSize: '14px',
                      fontWeight: '600',
                      color: '#15803d',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: '8px'
                    }}>
                      🎁 Your Exclusive Promo Code
                    </div>
                    <div style={{
                      fontFamily: '"Courier New", monospace',
                      fontSize: '28px',
                      fontWeight: '800',
                      color: '#16a34a',
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
                        <button style={{
                          backgroundColor: section.styling?.backgroundColor || '#F51042',
                          color: section.styling?.color || '#ffffff',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: section.styling?.fontSize || '16px',
                          fontWeight: '600',
                          padding: '12px 24px',
                          cursor: 'pointer'
                        }}>
                          {section.content || 'Button'}
                        </button>
                      </div>
                    )}
                    
                    {section.type === 'image' && (
                      <div style={{ textAlign: 'center' }}>
                        <img
                          src={section.content || 'https://via.placeholder.com/200x120?text=Image'}
                          alt="Email content"
                          style={{
                            width: '200px',
                            height: '120px',
                            borderRadius: '8px',
                            objectFit: 'cover'
                          }}
                        />
                      </div>
                    )}
                    
                    {section.type === 'divider' && (
                      <hr style={{
                        border: 'none',
                        height: '1px',
                        backgroundColor: '#e2e8f0',
                        margin: '16px 0'
                      }} />
                    )}
                  </div>
                ))}

                {/* Order Button */}
                <div 
                  className={`transition-all duration-200 ${
                    selectedElement === 'order-button' ? 'ring-2 ring-blue-500 rounded' : ''
                  }`}
                  style={{ textAlign: 'center', margin: '32px 0' }}
                  onClick={() => setSelectedElement('order-button')}
                >
                  <div 
                    className="inline-block cursor-pointer transition-colors"
                    style={{ 
                      background: 'linear-gradient(135deg, hsl(347, 91%, 51%) 0%, hsl(347, 91%, 45%) 100%)',
                      color: '#ffffff',
                      padding: '14px 28px',
                      borderRadius: '8px',
                      fontWeight: '600',
                      fontSize: '16px',
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