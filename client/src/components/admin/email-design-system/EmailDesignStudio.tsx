import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Crown,
  Grid3x3,
  Layout,
  Monitor,
  Palette,
  Save,
  Smartphone,
  Sparkles,
  Tablet,
  Type,
  Wand2
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Import our email design components
import { EmailCanvasDesigner } from './EmailCanvasDesigner';
import { ColorPalette } from './PremiumColorPalette';

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

export const EmailDesignStudio: React.FC<EmailDesignStudioProps> = ({
  onEmailGenerated,
  initialDesign
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('design');
  const [currentDesign, setCurrentDesign] = useState<EmailDesignData>(
    initialDesign || createDefaultDesign()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState('desktop');
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Create default design configuration
  function createDefaultDesign(): EmailDesignData {
    return {
      id: `design-${Date.now()}`,
      name: 'Untitled Design',
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
          primary: { main: '#16a34a', light: '#4ade80', dark: '#15803d', contrast: '#ffffff' },
          secondary: { main: '#64748b', light: '#94a3b8', dark: '#475569', contrast: '#ffffff' },
          accent: { main: '#f59e0b', light: '#fbbf24', dark: '#d97706', contrast: '#ffffff' },
          neutral: { main: '#6b7280', light: '#d1d5db', dark: '#374151', contrast: '#ffffff' },
          semantic: { success: '#16a34a', warning: '#f59e0b', error: '#dc2626', info: '#2563eb' },
          gradients: {
            primary: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)',
            secondary: 'linear-gradient(135deg, #64748b 0%, #94a3b8 100%)',
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
          brandColors: ['#F51042', '#16a34a'],
          fontFamily: 'Inter',
          tone: 'professional'
        }
      },
      content: {
        subject: '',
        previewText: '',
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
    };
  }

  // Real-time design updates
  const handleDesignUpdate = useCallback((updates: Partial<EmailDesignData>) => {
    setCurrentDesign(prev => {
      const updated = {
        ...prev,
        ...updates,
        metadata: {
          ...prev.metadata,
          ...updates.metadata,
          lastModified: new Date()
        }
      };
      
      // Auto-save functionality
      localStorage.setItem('emailDesign_draft', JSON.stringify(updated));
      
      return updated;
    });
  }, []);

  // Load saved design on mount
  useEffect(() => {
    const savedDesign = localStorage.getItem('emailDesign_draft');
    if (savedDesign && !initialDesign) {
      try {
        const parsed = JSON.parse(savedDesign);
        setCurrentDesign(parsed);
        toast({
          title: "Draft Loaded",
          description: "Restored your previous email design",
        });
      } catch (error) {
        console.error('Failed to load saved design:', error);
      }
    }
  }, [initialDesign, toast]);

  const handleGenerateEmail = async () => {
    if (!currentDesign.content.promoCode || !currentDesign.content.customMessage) {
      toast({
        title: "Missing Content",
        description: "Please add promo code and custom message",
        variant: "destructive"
      });
      return;
    }

    setIsLoading(true);
    
    try {
          // Simulate processing time for email generation
    await new Promise(resolve => setTimeout(resolve, 1500));
      
      const finalDesign = {
        ...currentDesign,
        metadata: {
          ...currentDesign.metadata,
          lastModified: new Date()
        }
      };

      // Clear draft
      localStorage.removeItem('emailDesign_draft');

      onEmailGenerated(finalDesign);
      
      toast({
              title: "🎨 Email Generated!",
      description: "Your email design is ready to send",
      });
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "Failed to generate email design",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleColorSystemUpdate = (colorSystem: ColorSystemConfig) => {
    handleDesignUpdate({
      designSystem: {
        ...currentDesign.designSystem,
        colors: colorSystem
      }
    });
    
    toast({
      title: "Colors Updated",
      description: "Email preview updated with new color system",
    });
  };

  const handleContentUpdate = (content: Partial<EmailContent>) => {
    handleDesignUpdate({
      content: {
        ...currentDesign.content,
        ...content
      }
    });
  };

  const handleFontChange = (fontType: string, value: string) => {
    handleDesignUpdate({
      designSystem: {
        ...currentDesign.designSystem,
        typography: {
          ...currentDesign.designSystem.typography,
          [fontType]: value
        }
      }
    });
    
    toast({
      title: "Typography Updated",
      description: `${fontType} font changed to ${value}`,
    });
  };

  const handleLayoutChange = (layoutProp: string, value: string) => {
    handleDesignUpdate({
      designSystem: {
        ...currentDesign.designSystem,
        layout: {
          ...currentDesign.designSystem.layout,
          [layoutProp]: value
        }
      }
    });
    
    toast({
      title: "Layout Updated",
      description: `${layoutProp} changed to ${value}`,
    });
  };

  const saveDesign = () => {
    localStorage.setItem(`emailDesign_${currentDesign.id}`, JSON.stringify(currentDesign));
    toast({
      title: "Design Saved",
      description: "Your email design has been saved successfully",
    });
  };

  // Generate email preview styles based on current design
  const getEmailPreviewStyles = () => {
    const { colors, typography, layout } = currentDesign.designSystem;
    
    return {
      maxWidth: layout.maxWidth,
      padding: layout.padding,
      borderRadius: layout.borderRadius,
      fontFamily: typography.primaryFont,
      fontSize: typography.hierarchy.body.fontSize,
      lineHeight: typography.hierarchy.body.lineHeight,
      backgroundColor: colors.neutral.light,
      color: colors.neutral.dark
    };
  };

  const getPreviewDimensions = () => {
    switch (previewMode) {
      case 'mobile': return { width: '320px', height: '600px' };
      case 'tablet': return { width: '500px', height: '700px' };
      default: return { width: '600px', height: '800px' };
    }
  };

  return (
    <div className="w-full bg-white">
      {/* Fixed Header */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg">
                  <Crown className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Email Design Studio</h1>
                  <p className="text-sm text-gray-600">Advanced Email Customization Platform</p>
                </div>
              </div>
              <Badge variant="outline" className="bg-gradient-to-r from-yellow-50 to-amber-50 text-yellow-800 border-yellow-200 font-medium">
                <Sparkles className="h-3 w-3 mr-1" />
                Advanced Studio
              </Badge>
            </div>

            <div className="flex items-center space-x-3">
              {/* Preview Mode Selector */}
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

              <Button variant="outline" size="sm" onClick={saveDesign}>
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>

              <Button 
                onClick={handleGenerateEmail}
                disabled={isLoading}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-medium"
              >
                {isLoading ? (
                  <>
                    <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Email
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-120px)]">
        {/* Left Sidebar - Design Tools */}
        <div className="w-80 bg-gray-50 border-r border-gray-200 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 m-4 bg-white shadow-sm">
              <TabsTrigger value="design" className="text-xs">
                <Layout className="h-4 w-4 mr-1" />
                Design
              </TabsTrigger>
              <TabsTrigger value="colors" className="text-xs">
                <Palette className="h-4 w-4 mr-1" />
                Colors
              </TabsTrigger>
              <TabsTrigger value="typography" className="text-xs">
                <Type className="h-4 w-4 mr-1" />
                Type
              </TabsTrigger>
              <TabsTrigger value="layout" className="text-xs">
                <Grid3x3 className="h-4 w-4 mr-1" />
                Layout
              </TabsTrigger>
            </TabsList>

            <div className="px-4 pb-4">
              <TabsContent value="design" className="mt-0">
                <EmailCanvasDesigner 
                  currentDesign={currentDesign}
                  onDesignUpdate={handleDesignUpdate}
                  onContentUpdate={handleContentUpdate}
                  selectedElement={selectedElement}
                  onElementSelect={setSelectedElement}
                />
              </TabsContent>

              <TabsContent value="colors" className="mt-0">
                <ColorPalette
                  colorSystem={currentDesign.designSystem.colors}
                  onColorSystemUpdate={handleColorSystemUpdate}
                />
              </TabsContent>

              <TabsContent value="typography" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center text-gray-900">
                      <Type className="h-5 w-5 mr-2" />
                      Typography Studio
                    </CardTitle>
                    <CardDescription>
                      Font and text styling controls
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700">Primary Font</label>
                        <select 
                          value={currentDesign.designSystem.typography.primaryFont}
                          onChange={(e) => handleFontChange('primaryFont', e.target.value)}
                          className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="Inter">Inter</option>
                          <option value="Roboto">Roboto</option>
                          <option value="Open Sans">Open Sans</option>
                          <option value="Lato">Lato</option>
                          <option value="Montserrat">Montserrat</option>
                          <option value="Poppins">Poppins</option>
                        </select>
                      </div>
                      
                      <div>
                        <label className="text-sm font-medium text-gray-700">Secondary Font</label>
                        <select 
                          value={currentDesign.designSystem.typography.secondaryFont}
                          onChange={(e) => handleFontChange('secondaryFont', e.target.value)}
                          className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="Roboto">Roboto</option>
                          <option value="Inter">Inter</option>
                          <option value="Open Sans">Open Sans</option>
                          <option value="Source Sans Pro">Source Sans Pro</option>
                        </select>
                      </div>

                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-semibold text-blue-900 mb-2">Font Hierarchy</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span className="text-blue-700">Heading 1:</span>
                            <span className="font-bold text-blue-900">32px / Bold</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Heading 2:</span>
                            <span className="font-semibold text-blue-900">24px / Semi-bold</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-blue-700">Body:</span>
                            <span className="text-blue-900">16px / Regular</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="layout" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center text-gray-900">
                      <Grid3x3 className="h-5 w-5 mr-2" />
                      Layout System
                    </CardTitle>
                    <CardDescription>
                      Grid and spacing controls
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <label className="text-sm font-medium text-gray-700">Max Width</label>
                      <select 
                        value={currentDesign.designSystem.layout.maxWidth}
                        onChange={(e) => handleLayoutChange('maxWidth', e.target.value)}
                        className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                      >
                        <option value="480px">480px (Mobile)</option>
                        <option value="600px">600px (Standard)</option>
                        <option value="800px">800px (Wide)</option>
                        <option value="100%">100% (Responsive)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700">Padding</label>
                      <select 
                        value={currentDesign.designSystem.layout.padding}
                        onChange={(e) => handleLayoutChange('padding', e.target.value)}
                        className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                      >
                        <option value="16px">16px (Compact)</option>
                        <option value="24px">24px (Standard)</option>
                        <option value="32px">32px (Spacious)</option>
                        <option value="40px">40px (Extra)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-sm font-medium text-gray-700">Border Radius</label>
                      <select 
                        value={currentDesign.designSystem.layout.borderRadius}
                        onChange={(e) => handleLayoutChange('borderRadius', e.target.value)}
                        className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                      >
                        <option value="0px">0px (Square)</option>
                        <option value="8px">8px (Slight)</option>
                        <option value="12px">12px (Standard)</option>
                        <option value="16px">16px (Rounded)</option>
                        <option value="24px">24px (Very Rounded)</option>
                      </select>
                    </div>

                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <h4 className="font-semibold text-green-900 mb-2">Current Settings</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-green-700">Max Width:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.maxWidth}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-700">Padding:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.padding}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-700">Border Radius:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.borderRadius}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Main Canvas Area */}
        <div className="flex-1 bg-gray-100 overflow-hidden">
          <div className="h-full flex items-center justify-center p-8">
            <div 
              ref={canvasRef}
              className="bg-white shadow-lg transition-all duration-300"
              style={{ 
                ...getPreviewDimensions(),
                borderRadius: '12px',
                overflow: 'hidden'
              }}
            >
              {/* Email Preview Content with Real-time Updates */}
              <div className="h-full overflow-y-auto" style={getEmailPreviewStyles()}>
                <div className="p-6 space-y-6">
                  {/* Header with Dynamic Colors */}
                  <div 
                    className="text-white p-4 rounded-lg text-center"
                    style={{ 
                      background: currentDesign.designSystem.colors.gradients.primary,
                      borderRadius: currentDesign.designSystem.layout.borderRadius
                    }}
                  >
                    <h2 
                      className="text-xl font-bold"
                      style={{ 
                        fontFamily: currentDesign.designSystem.typography.primaryFont,
                        fontSize: currentDesign.designSystem.typography.hierarchy.h2.fontSize,
                        fontWeight: currentDesign.designSystem.typography.hierarchy.h2.fontWeight
                      }}
                    >
                      Local Cooks
                    </h2>
                    <p style={{ color: currentDesign.designSystem.colors.primary.light }}>
                      Special Offer Inside
                    </p>
                  </div>

                  {/* Content Preview with Live Updates */}
                  <div className="space-y-4">
                    <h3 
                      className="text-lg font-semibold"
                      style={{ 
                        color: currentDesign.designSystem.colors.neutral.dark,
                        fontFamily: currentDesign.designSystem.typography.primaryFont,
                        fontSize: currentDesign.designSystem.typography.hierarchy.h3.fontSize
                      }}
                    >
                      Exclusive Promo Code!
                    </h3>
                    
                    {currentDesign.content.customMessage ? (
                      <div 
                        className="p-4 rounded"
                        style={{ 
                          backgroundColor: currentDesign.designSystem.colors.neutral.light,
                          borderLeft: `4px solid ${currentDesign.designSystem.colors.primary.main}`,
                          borderRadius: currentDesign.designSystem.layout.borderRadius
                        }}
                      >
                        <p 
                          style={{ 
                            color: currentDesign.designSystem.colors.neutral.dark,
                            fontFamily: currentDesign.designSystem.typography.primaryFont,
                            fontSize: currentDesign.designSystem.typography.hierarchy.body.fontSize,
                            lineHeight: currentDesign.designSystem.typography.hierarchy.body.lineHeight
                          }}
                        >
                          {currentDesign.content.customMessage}
                        </p>
                      </div>
                    ) : (
                      <div className="p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded text-center">
                        <p className="text-gray-500">Custom message will appear here</p>
                      </div>
                    )}

                    {currentDesign.content.promoCode ? (
                      <div 
                        className="border rounded p-4 text-center"
                        style={{ 
                          backgroundColor: currentDesign.designSystem.colors.accent.light,
                          borderColor: currentDesign.designSystem.colors.accent.main,
                          borderRadius: currentDesign.designSystem.layout.borderRadius
                        }}
                      >
                        <p 
                          className="text-sm font-medium"
                          style={{ color: currentDesign.designSystem.colors.accent.dark }}
                        >
                          Your Promo Code
                        </p>
                        <p 
                          className="text-2xl font-bold"
                          style={{ 
                            color: currentDesign.designSystem.colors.accent.dark,
                            fontFamily: currentDesign.designSystem.typography.primaryFont
                          }}
                        >
                          {currentDesign.content.promoCode}
                        </p>
                      </div>
                    ) : (
                      <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded p-4 text-center">
                        <p className="text-gray-500">Promo code will appear here</p>
                      </div>
                    )}

                    <div className="text-center">
                      <div 
                        className="inline-block text-white px-6 py-3 rounded font-medium cursor-pointer transition-colors"
                        style={{ 
                          backgroundColor: currentDesign.designSystem.colors.primary.main,
                          borderRadius: currentDesign.designSystem.layout.borderRadius,
                          fontFamily: currentDesign.designSystem.typography.primaryFont
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = currentDesign.designSystem.colors.primary.dark;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = currentDesign.designSystem.colors.primary.main;
                        }}
                      >
                        Order Now
                      </div>
                    </div>

                    {/* Render Custom Elements */}
                    {currentDesign.content.sections.map((section) => (
                      <div
                        key={section.id}
                        className={`cursor-pointer transition-all duration-200 ${
                          selectedElement === section.id ? 'ring-2 ring-blue-500' : ''
                        }`}
                        onClick={() => setSelectedElement(section.id)}
                        style={{
                          ...section.styling,
                          fontFamily: currentDesign.designSystem.typography.primaryFont
                        }}
                      >
                        {section.type === 'text' && (
                          <div style={{ color: section.styling.color || currentDesign.designSystem.colors.neutral.dark }}>
                            {section.content}
                          </div>
                        )}
                        {section.type === 'button' && (
                          <button
                            className="px-4 py-2 rounded font-medium"
                            style={{
                              backgroundColor: section.styling.backgroundColor || currentDesign.designSystem.colors.primary.main,
                              color: section.styling.color || currentDesign.designSystem.colors.primary.contrast,
                              borderRadius: currentDesign.designSystem.layout.borderRadius
                            }}
                          >
                            {section.content || 'Button'}
                          </button>
                        )}
                        {section.type === 'image' && (
                          <div 
                            className="bg-gray-200 flex items-center justify-center text-gray-500 text-sm"
                            style={{ 
                              width: section.styling.width || '200px',
                              height: section.styling.height || '100px',
                              borderRadius: currentDesign.designSystem.layout.borderRadius
                            }}
                          >
                            Image Placeholder
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 