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
    Send,
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
  orderButton?: {
    text: string;
    url: string;
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
    title: string;
    subtitle: string;
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
  const [activeTab, setActiveTab] = useState('design');
  const [currentDesign, setCurrentDesign] = useState<EmailDesignData>(
    initialDesign || createDefaultDesign()
  );
  const [isLoading, setIsLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
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
        subject: '',
        previewText: '',
        sections: [],
        promoCode: '',
        customMessage: '',
        email: '',
        orderButton: {
          text: 'Order Now',
          url: '#',
          styling: {
            backgroundColor: '#F51042',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '600',
            padding: '12px 24px',
            borderRadius: '8px',
            textAlign: 'center'
          }
        },
        header: {
          title: 'Local Cooks',
          subtitle: 'Special Offer Inside',
          styling: {
            backgroundColor: '#F51042',
            titleColor: '#ffffff',
            subtitleColor: '#ffffff',
            titleFontSize: '32px',
            subtitleFontSize: '18px',
            padding: '24px',
            borderRadius: '12px',
            textAlign: 'center'
          }
        }
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
    // Update the layout configuration
    const updatedDesign = {
      ...currentDesign,
      designSystem: {
        ...currentDesign.designSystem,
        layout: {
          ...currentDesign.designSystem.layout,
          [layoutProp]: value
        }
      }
    };

    // Automatically apply layout changes to all elements
    if (['maxWidth', 'padding', 'borderRadius'].includes(layoutProp)) {
      const updatedSections = currentDesign.content.sections.map(section => {
        const updatedStyling = { ...section.styling };

        // Apply specific layout property changes
        switch (layoutProp) {
          case 'maxWidth':
            updatedStyling.maxWidth = value;
            break;
          case 'padding':
            // Apply to elements that should inherit global padding
            updatedStyling.padding = value;
            if (section.type === 'text') {
              updatedStyling.paddingLeft = value;
              updatedStyling.paddingRight = value;
            } else if (section.type === 'button') {
              updatedStyling.paddingLeft = parseInt(value) * 1.5 + 'px';
              updatedStyling.paddingRight = parseInt(value) * 1.5 + 'px';
            }
            break;
          case 'borderRadius':
            updatedStyling.borderRadius = value;
            break;
        }

        return {
          ...section,
          styling: updatedStyling
        };
      });

      updatedDesign.content = {
        ...updatedDesign.content,
        sections: updatedSections
      };
    }

    setCurrentDesign(updatedDesign);
    
    toast({
      title: "Layout Updated",
      description: `${layoutProp} changed to ${value} and applied to all elements`,
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

  const handleSendTestEmail = () => {
    // Implementation of handleSendTestEmail
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
        <div className="w-96 bg-gray-50 border-r border-gray-200 overflow-y-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 m-4 bg-white shadow-sm">
              <TabsTrigger value="design" className="text-xs px-2">
                <Layout className="h-4 w-4 mr-1" />
                Design
              </TabsTrigger>
              <TabsTrigger value="colors" className="text-xs px-2">
                <Palette className="h-4 w-4 mr-1" />
                Colors
              </TabsTrigger>
              <TabsTrigger value="typography" className="text-xs px-2">
                <Type className="h-4 w-4 mr-1" />
                Type
              </TabsTrigger>
              <TabsTrigger value="layout" className="text-xs px-2">
                <Grid3x3 className="h-4 w-4 mr-1" />
                Layout
              </TabsTrigger>
            </TabsList>

            <div className="px-4 pb-4 space-y-4">
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
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center text-gray-900">
                      <Type className="h-5 w-5 mr-2" />
                      Typography Studio
                    </CardTitle>
                    <CardDescription className="text-sm">
                      Font and text styling controls
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-gray-700 block mb-2">Primary Font</label>
                        <select 
                          value={currentDesign.designSystem.typography.primaryFont}
                          onChange={(e) => handleFontChange('primaryFont', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md text-sm"
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
                        <label className="text-sm font-medium text-gray-700 block mb-2">Secondary Font</label>
                        <select 
                          value={currentDesign.designSystem.typography.secondaryFont}
                          onChange={(e) => handleFontChange('secondaryFont', e.target.value)}
                          className="w-full p-2 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="Roboto">Roboto</option>
                          <option value="Inter">Inter</option>
                          <option value="Open Sans">Open Sans</option>
                          <option value="Source Sans Pro">Source Sans Pro</option>
                        </select>
                      </div>

                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-semibold text-blue-900 mb-2 text-sm">Font Hierarchy</h4>
                        <div className="space-y-1 text-xs">
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
                      Grid and spacing controls that apply to all elements
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Container Settings */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-900 border-b pb-2">Container Settings</h4>
                      
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
                        <p className="text-xs text-gray-500 mt-1">
                          Controls the maximum width of all elements
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-700">Global Padding</label>
                        <select 
                          value={currentDesign.designSystem.layout.padding}
                          onChange={(e) => handleLayoutChange('padding', e.target.value)}
                          className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="8px">8px (Compact)</option>
                          <option value="16px">16px (Standard)</option>
                          <option value="24px">24px (Comfortable)</option>
                          <option value="32px">32px (Spacious)</option>
                          <option value="40px">40px (Extra Spacious)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Default padding applied to text and button elements
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium text-gray-700">Border Radius</label>
                        <select 
                          value={currentDesign.designSystem.layout.borderRadius}
                          onChange={(e) => handleLayoutChange('borderRadius', e.target.value)}
                          className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="0px">0px (Square)</option>
                          <option value="4px">4px (Slight)</option>
                          <option value="8px">8px (Small)</option>
                          <option value="12px">12px (Standard)</option>
                          <option value="16px">16px (Medium)</option>
                          <option value="24px">24px (Large)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Border radius applied to all elements with backgrounds
                        </p>
                      </div>
                    </div>

                    {/* Spacing Settings */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-gray-900 border-b pb-2">Spacing System</h4>
                      
                      <div>
                        <label className="text-sm font-medium text-gray-700">Element Spacing</label>
                        <select 
                          value={currentDesign.designSystem.layout.gridSystem}
                          onChange={(e) => handleLayoutChange('gridSystem', e.target.value)}
                          className="w-full mt-1 p-2 border border-gray-300 rounded-md"
                        >
                          <option value="tight">Tight (8px gaps)</option>
                          <option value="normal">Normal (16px gaps)</option>
                          <option value="relaxed">Relaxed (24px gaps)</option>
                          <option value="loose">Loose (32px gaps)</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Controls spacing between email elements
                        </p>
                      </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="space-y-2 pt-4 border-t">
                      <h4 className="font-medium text-gray-900">Quick Actions</h4>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // Apply mobile-optimized layout
                            handleLayoutChange('maxWidth', '480px');
                            handleLayoutChange('padding', '16px');
                            handleLayoutChange('borderRadius', '8px');
                          }}
                          className="text-xs"
                        >
                          📱 Mobile Layout
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            // Apply desktop-optimized layout
                            handleLayoutChange('maxWidth', '600px');
                            handleLayoutChange('padding', '24px');
                            handleLayoutChange('borderRadius', '12px');
                          }}
                          className="text-xs"
                        >
                          🖥️ Desktop Layout
                        </Button>
                      </div>
                    </div>

                    {/* Current Settings Preview */}
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <h4 className="font-semibold text-green-900 mb-2">Current Layout Settings</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-green-700">Max Width:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.maxWidth}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-700">Global Padding:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.padding}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-700">Border Radius:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.borderRadius}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-green-700">Element Spacing:</span>
                          <span className="text-green-900 font-medium">{currentDesign.designSystem.layout.gridSystem}</span>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-2 bg-green-100 rounded text-xs text-green-800">
                        💡 <strong>Auto-Apply:</strong> Layout changes automatically apply to all elements. Use individual element controls for fine-tuning.
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
                    className={`text-white rounded-lg cursor-pointer transition-all duration-200 ${
                      selectedElement === 'email-header' ? 'ring-2 ring-blue-500' : ''
                    }`}
                    style={{ 
                      background: currentDesign.content.header?.styling?.backgroundColor || currentDesign.designSystem.colors.gradients.primary,
                      borderRadius: currentDesign.content.header?.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius,
                      padding: currentDesign.content.header?.styling?.padding || '24px',
                      textAlign: currentDesign.content.header?.styling?.textAlign || 'center'
                    }}
                    onClick={() => setSelectedElement('email-header')}
                  >
                    <h2 
                      className="font-bold"
                      style={{ 
                        fontFamily: currentDesign.designSystem.typography.primaryFont,
                        fontSize: currentDesign.content.header?.styling?.titleFontSize || currentDesign.designSystem.typography.hierarchy.h2.fontSize,
                        fontWeight: currentDesign.designSystem.typography.hierarchy.h2.fontWeight,
                        color: currentDesign.content.header?.styling?.titleColor || '#ffffff',
                        marginBottom: '8px'
                      }}
                    >
                      {currentDesign.content.header?.title || 'Local Cooks'}
                    </h2>
                    <p style={{ 
                      color: currentDesign.content.header?.styling?.subtitleColor || currentDesign.designSystem.colors.primary.light,
                      fontSize: currentDesign.content.header?.styling?.subtitleFontSize || '18px',
                      margin: '0'
                    }}>
                      {currentDesign.content.header?.subtitle || 'Special Offer Inside'}
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
                        className={`p-4 rounded cursor-pointer transition-all duration-200 ${
                          selectedElement === 'custom-message' ? 'ring-2 ring-blue-500' : ''
                        }`}
                        style={{ 
                          backgroundColor: currentDesign.designSystem.colors.neutral.light,
                          borderLeft: `4px solid ${currentDesign.designSystem.colors.primary.main}`,
                          borderRadius: currentDesign.designSystem.layout.borderRadius
                        }}
                        onClick={() => setSelectedElement('custom-message')}
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
                      <div 
                        className={`p-4 bg-gray-50 border-2 border-dashed border-gray-300 rounded text-center cursor-pointer transition-all duration-200 ${
                          selectedElement === 'custom-message' ? 'ring-2 ring-blue-500' : ''
                        }`}
                        onClick={() => setSelectedElement('custom-message')}
                      >
                        <p className="text-gray-500">Custom message will appear here</p>
                      </div>
                    )}

                    {currentDesign.content.promoCode ? (
                      <div 
                        className={`border rounded p-4 text-center cursor-pointer transition-all duration-200 ${
                          selectedElement === 'promo-code' ? 'ring-2 ring-blue-500' : ''
                        }`}
                        style={{ 
                          backgroundColor: currentDesign.designSystem.colors.accent.light,
                          borderColor: currentDesign.designSystem.colors.accent.main,
                          borderRadius: currentDesign.designSystem.layout.borderRadius
                        }}
                        onClick={() => setSelectedElement('promo-code')}
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
                      <div 
                        className={`bg-gray-50 border-2 border-dashed border-gray-300 rounded p-4 text-center cursor-pointer transition-all duration-200 ${
                          selectedElement === 'promo-code' ? 'ring-2 ring-blue-500' : ''
                        }`}
                        onClick={() => setSelectedElement('promo-code')}
                      >
                        <p className="text-gray-500">Promo code will appear here</p>
                      </div>
                    )}

                    <div 
                      className={`transition-all duration-200 ${
                        selectedElement === 'order-button' ? 'ring-2 ring-blue-500 rounded' : ''
                      }`}
                      style={{
                        textAlign: currentDesign.content.orderButton?.styling?.textAlign || 'center'
                      }}
                      onClick={() => setSelectedElement('order-button')}
                    >
                      <div 
                        className="inline-block cursor-pointer transition-colors"
                        style={{ 
                          backgroundColor: currentDesign.content.orderButton?.styling?.backgroundColor || currentDesign.designSystem.colors.primary.main,
                          color: currentDesign.content.orderButton?.styling?.color || currentDesign.designSystem.colors.primary.contrast,
                          borderRadius: currentDesign.content.orderButton?.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius,
                          fontSize: currentDesign.content.orderButton?.styling?.fontSize || '16px',
                          fontWeight: currentDesign.content.orderButton?.styling?.fontWeight || '600',
                          fontFamily: currentDesign.designSystem.typography.primaryFont,
                          padding: currentDesign.content.orderButton?.styling?.padding || '12px 24px',
                          border: 'none',
                          textDecoration: 'none',
                          display: 'inline-block'
                        }}
                        onMouseEnter={(e) => {
                          // Darken background on hover
                          const bgColor = currentDesign.content.orderButton?.styling?.backgroundColor || currentDesign.designSystem.colors.primary.main;
                          if (bgColor.startsWith('#')) {
                            // Simple darkening for hex colors
                            const darkerColor = bgColor.length === 7 
                              ? '#' + bgColor.slice(1).split('').map(char => 
                                  Math.max(0, parseInt(char, 16) - 2).toString(16).padStart(1, '0')
                                ).join('')
                              : currentDesign.designSystem.colors.primary.dark;
                            e.currentTarget.style.backgroundColor = darkerColor;
                          } else {
                            e.currentTarget.style.backgroundColor = currentDesign.designSystem.colors.primary.dark;
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = currentDesign.content.orderButton?.styling?.backgroundColor || currentDesign.designSystem.colors.primary.main;
                        }}
                      >
                        {currentDesign.content.orderButton?.text || 'Order Now'}
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
                          maxWidth: section.styling?.maxWidth || currentDesign.designSystem.layout.maxWidth,
                          margin: '0 auto',
                          marginTop: section.styling?.marginTop || '0px',
                          marginBottom: section.styling?.marginBottom || '16px',
                        }}
                      >
                        {section.type === 'text' && (
                          <div style={{ 
                            color: section.styling?.color || currentDesign.designSystem.colors.neutral.dark,
                            textAlign: section.styling?.textAlign || 'left',
                            fontSize: section.styling?.fontSize || '16px',
                            fontWeight: section.styling?.fontWeight || '400',
                            fontFamily: currentDesign.designSystem.typography.primaryFont,
                            background: section.styling?.backgroundColor || 'transparent',
                            borderRadius: section.styling?.backgroundColor && section.styling?.backgroundColor !== 'transparent' 
                              ? (section.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius) 
                              : '0',
                            padding: section.styling?.padding || 
                                    `${section.styling?.paddingTop || '8px'} ${section.styling?.paddingRight || '0px'} ${section.styling?.paddingBottom || '8px'} ${section.styling?.paddingLeft || '0px'}`,
                            lineHeight: '1.6'
                          }}>
                            {section.content || 'Text content'}
                          </div>
                        )}
                        
                        {section.type === 'button' && (
                          <div style={{ textAlign: section.styling?.textAlign || 'center' }}>
                            <button
                              style={{
                                backgroundColor: section.styling?.backgroundColor || currentDesign.designSystem.colors.primary.main,
                                color: section.styling?.color || currentDesign.designSystem.colors.primary.contrast,
                                border: 'none',
                                borderRadius: section.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius,
                                fontSize: section.styling?.fontSize || '16px',
                                fontWeight: section.styling?.fontWeight || '600',
                                fontFamily: currentDesign.designSystem.typography.primaryFont,
                                padding: section.styling?.padding || 
                                        `${section.styling?.paddingTop || '12px'} ${section.styling?.paddingRight || '24px'} ${section.styling?.paddingBottom || '12px'} ${section.styling?.paddingLeft || '24px'}`,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'inline-block'
                              }}
                            >
                              {section.content || 'Button'}
                            </button>
                          </div>
                        )}
                        
                        {section.type === 'image' && (
                          <div style={{ 
                            textAlign: section.styling?.textAlign || 'center',
                            position: 'relative'
                          }}>
                            <img
                              src={section.content || 'https://via.placeholder.com/200x120?text=Image'}
                              alt="Email content"
                              style={{
                                width: section.styling?.width || '200px',
                                height: section.styling?.height || '120px',
                                borderRadius: section.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius,
                                objectFit: 'cover',
                                display: 'inline-block'
                              }}
                              onError={(e) => {
                                e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDIwMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMTIwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMDAgNjBMMTIwIDQwSDgwTDEwMCA2MFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHN2Zz4K";
                              }}
                            />
                            {/* Image Text Overlay */}
                            {section.overlay?.enabled && section.overlay?.text && (
                              <div
                                style={{
                                  position: 'absolute',
                                  top: '50%',
                                  left: '50%',
                                  transform: 'translate(-50%, -50%)',
                                  color: section.overlay?.styling?.color || '#ffffff',
                                  fontSize: section.overlay?.styling?.fontSize || '18px',
                                  fontWeight: section.overlay?.styling?.fontWeight || '600',
                                  textAlign: section.overlay?.styling?.textAlign || 'center',
                                  backgroundColor: section.overlay?.styling?.backgroundColor || 'rgba(0, 0, 0, 0.5)',
                                  padding: section.overlay?.styling?.padding || '8px 16px',
                                  borderRadius: section.overlay?.styling?.borderRadius || '4px',
                                  textShadow: section.overlay?.styling?.textShadow || '0 1px 2px rgba(0,0,0,0.5)',
                                  fontFamily: currentDesign.designSystem.typography.primaryFont,
                                  whiteSpace: 'pre-wrap',
                                  maxWidth: '80%'
                                }}
                              >
                                {section.overlay.text}
                              </div>
                            )}
                          </div>
                        )}
                        
                        {section.type === 'divider' && (
                          <hr style={{
                            border: 'none',
                            height: '1px',
                            backgroundColor: section.styling?.color || currentDesign.designSystem.colors.neutral.main,
                            margin: `${section.styling?.marginTop || '16px'} 0 ${section.styling?.marginBottom || '16px'} 0`,
                            opacity: 0.3
                          }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Email Preview */}
        <div className="flex-1 bg-white border-l border-gray-200 overflow-hidden">
          <div className="h-full flex flex-col">
            {/* Preview Header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <h2 className="text-lg font-semibold text-gray-900">Email Preview</h2>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant={previewMode === 'desktop' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPreviewMode('desktop')}
                      className="h-8 px-3"
                    >
                      <Monitor className="h-3 w-3 mr-1" />
                      <span className="text-xs">Desktop</span>
                    </Button>
                    <Button
                      variant={previewMode === 'mobile' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setPreviewMode('mobile')}
                      className="h-8 px-3"
                    >
                      <Smartphone className="h-3 w-3 mr-1" />
                      <span className="text-xs">Mobile</span>
                    </Button>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSendTestEmail}
                    disabled={!currentDesign.content.email || isSending}
                    className="h-8 px-3"
                  >
                    {isSending ? (
                      <div className="flex items-center">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 mr-1"></div>
                        <span className="text-xs">Sending...</span>
                      </div>
                    ) : (
                      <>
                        <Send className="h-3 w-3 mr-1" />
                        <span className="text-xs">Test Email</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}; 