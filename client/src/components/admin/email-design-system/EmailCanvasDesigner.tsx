import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ChevronDown,
    Copy,
    Edit3,
    Eye,
    Grid3x3,
    Image as ImageIcon,
    MousePointer,
    Move,
    Paintbrush2,
    RotateCcw,
    Settings,
    Trash2,
    Type,
    Upload
} from "lucide-react";
import React, { useCallback, useState } from 'react';
import { GradientColorPicker } from "./GradientColorPicker";

// Interface definitions
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

export interface EmailCanvasDesignerProps {
  currentDesign: EmailDesignData;
  onDesignUpdate: (updates: Partial<EmailDesignData>) => void;
  onContentUpdate: (content: Partial<EmailContent>) => void;
  selectedElement: string | null;
  onElementSelect: (elementId: string | null) => void;
}

export const EmailCanvasDesigner: React.FC<EmailCanvasDesignerProps> = ({
  currentDesign,
  onDesignUpdate,
  onContentUpdate,
  selectedElement,
  onElementSelect
}) => {
  const { toast } = useToast();
  const [draggedElement, setDraggedElement] = useState<string | null>(null);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  
  // Collapsible state management
  const [sectionsOpen, setSectionsOpen] = useState({
    emailSettings: true,
    contentEditor: true,
    elementLibrary: false,
    elementList: false,
    elementProperties: true,
    specialElements: true,
    quickActions: false
  });

  const toggleSection = (section: keyof typeof sectionsOpen) => {
    setSectionsOpen(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Initialize file upload hook for image uploads
  const { uploadFile, isUploading, uploadProgress, error: uploadError } = useFileUpload({
    maxSize: 4.5 * 1024 * 1024, // 4.5MB limit for Vercel
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'],
    onSuccess: (response) => {
      toast({
        title: "Image uploaded successfully",
        description: `${response.fileName} has been uploaded and added to your email.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error,
        variant: "destructive",
      });
    }
  });

  // Element templates
  const elementTemplates = [
    {
      id: 'text',
      label: 'Text Block',
      icon: Type,
      template: {
        type: 'text',
        content: 'Enter your text here...',
        styling: {
          fontSize: '16px',
          color: currentDesign.designSystem.colors.neutral.dark,
          fontWeight: '400',
          textAlign: 'left',
          padding: '8px 0',
          margin: '0',
          backgroundColor: 'transparent'
        }
      }
    },
    {
      id: 'button',
      label: 'CTA Button',
      icon: MousePointer,
      template: {
        type: 'button',
        content: 'Click Here',
        styling: {
          backgroundColor: currentDesign.designSystem.colors.primary.main,
          color: currentDesign.designSystem.colors.primary.contrast,
          padding: '12px 24px',
          borderRadius: currentDesign.designSystem.layout.borderRadius,
          fontWeight: '600',
          textAlign: 'center',
          display: 'inline-block',
          textDecoration: 'none',
          cursor: 'pointer'
        }
      }
    },
    {
      id: 'image',
      label: 'Image',
      icon: ImageIcon,
      template: {
        type: 'image',
        content: '',
        styling: {
          width: '200px',
          height: '120px',
          borderRadius: currentDesign.designSystem.layout.borderRadius,
          objectFit: 'cover',
          textAlign: 'center'
        },
        overlay: {
          text: '',
          enabled: false,
          styling: {
            color: '#ffffff',
            fontSize: '18px',
            fontWeight: '600',
            textAlign: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            padding: '12px 20px',
            borderRadius: '6px',
            textShadow: '1px 1px 2px rgba(0, 0, 0, 0.7)'
          }
        }
      }
    },
    {
      id: 'divider',
      label: 'Divider',
      icon: AlignCenter,
      template: {
        type: 'divider',
        content: '',
        styling: {
          height: '1px',
          backgroundColor: currentDesign.designSystem.colors.neutral.light,
          margin: '20px 0',
          border: 'none',
          textAlign: 'center'
        }
      }
    }
  ];

  // Add element to email
  const addElement = useCallback((elementType: string) => {
    const template = elementTemplates.find(t => t.id === elementType);
    if (!template) return;

    const newElement: EmailSection = {
      id: `element-${Date.now()}`,
      ...template.template
    };

    const updatedSections = [...currentDesign.content.sections, newElement];
    
    onContentUpdate({
      sections: updatedSections
    });

    onElementSelect(newElement.id);

    toast({
      title: "Element Added",
      description: `${template.label} has been added to your email`,
    });
  }, [currentDesign.content.sections, onContentUpdate, onElementSelect, toast, elementTemplates]);

  // Update element content
  const updateElementContent = (content: string) => {
    if (!selectedElement) return;

    updateElement(selectedElement, { content });
  };

  // Handle image upload for image elements
  const handleImageUpload = async (file: File | null) => {
    if (!file || !selectedElement || selectedElementData?.type !== 'image') return;

    try {
      const response = await uploadFile(file);
      if (response && response.url) {
        // Update the image element's content with the uploaded image URL
        updateElementContent(response.url);
        
        toast({
          title: "Image Updated",
          description: "Your email image has been updated successfully.",
        });
      }
    } catch (error) {
      console.error('Image upload error:', error);
    }
  };

  // Update element
  const updateElement = useCallback((elementId: string, updates: Partial<EmailSection>) => {
    const updatedSections = currentDesign.content.sections.map(section => 
      section.id === elementId 
        ? { ...section, ...updates }
        : section
    );

    onContentUpdate({
      sections: updatedSections
    });

    toast({
      title: "Element Updated",
      description: "Your changes have been applied",
    });
  }, [currentDesign.content.sections, onContentUpdate, toast]);

  // Delete element
  const deleteElement = useCallback((elementId: string) => {
    const updatedSections = currentDesign.content.sections.filter(section => section.id !== elementId);
    
    onContentUpdate({
      sections: updatedSections
    });

    if (selectedElement === elementId) {
      onElementSelect(null);
    }

    toast({
      title: "Element Deleted",
      description: "Element has been removed from your email",
    });
  }, [currentDesign.content.sections, onContentUpdate, selectedElement, onElementSelect, toast]);

  // Duplicate element
  const duplicateElement = useCallback((elementId: string) => {
    const elementToDuplicate = currentDesign.content.sections.find(section => section.id === elementId);
    if (!elementToDuplicate) return;

    const duplicatedElement: EmailSection = {
      ...elementToDuplicate,
      id: `element-${Date.now()}`
    };

    const updatedSections = [...currentDesign.content.sections, duplicatedElement];
    
    onContentUpdate({
      sections: updatedSections
    });

    onElementSelect(duplicatedElement.id);

    toast({
      title: "Element Duplicated",
      description: "Element has been duplicated successfully",
    });
  }, [currentDesign.content.sections, onContentUpdate, onElementSelect, toast]);

  // Update promo code and custom message
  const handlePromoCodeChange = (value: string) => {
    onContentUpdate({ promoCode: value });
  };

  const handleCustomMessageChange = (value: string) => {
    onContentUpdate({ customMessage: value });
  };

  const handleEmailChange = (value: string) => {
    onContentUpdate({ email: value });
  };

  // Add handlers for order button customization
  const handleOrderButtonTextChange = (value: string) => {
    onContentUpdate({ 
      orderButton: {
        ...currentDesign.content.orderButton,
        text: value,
        url: currentDesign.content.orderButton?.url || 'https://your-website.com/order'
      }
    });
  };

  const handleOrderButtonUrlChange = (value: string) => {
    onContentUpdate({ 
      orderButton: {
        ...currentDesign.content.orderButton,
        text: currentDesign.content.orderButton?.text || 'Order Now',
        url: value
      }
    });
  };

  const handleOrderButtonStylingChange = (property: string, value: string) => {
    onContentUpdate({ 
      orderButton: {
        ...currentDesign.content.orderButton,
        text: currentDesign.content.orderButton?.text || 'Order Now',
        url: currentDesign.content.orderButton?.url || 'https://your-website.com/order',
        styling: {
          ...currentDesign.content.orderButton?.styling,
          [property]: value
        }
      }
    });
  };

  // Add handlers for header customization
  const handleHeaderTitleChange = (value: string) => {
    onContentUpdate({ 
      header: {
        ...currentDesign.content.header,
        title: value,
        subtitle: currentDesign.content.header?.subtitle || 'Special Offer Inside'
      }
    });
  };

  const handleHeaderSubtitleChange = (value: string) => {
    onContentUpdate({ 
      header: {
        ...currentDesign.content.header,
        title: currentDesign.content.header?.title || 'Local Cooks',
        subtitle: value
      }
    });
  };

  const handleHeaderStylingChange = (property: string, value: string) => {
    // Prevent changes to header background color to maintain brand consistency
    if (property === 'backgroundColor') {
      console.log('Header background color changes are disabled to maintain brand consistency');
      return;
    }
    
    onContentUpdate({ 
      header: {
        ...currentDesign.content.header,
        title: currentDesign.content.header?.title || 'Local Cooks',
        subtitle: currentDesign.content.header?.subtitle || 'Special Offer Inside',
        styling: {
          ...currentDesign.content.header?.styling,
          [property]: value
        }
      }
    });
  };

  // Get selected element
  const getSelectedElement = () => {
    return currentDesign.content.sections.find(section => section.id === selectedElement);
  };

  const selectedElementData = getSelectedElement();

  // Update element styling
  const updateElementStyling = (property: string, value: string) => {
    if (!selectedElement) return;

    updateElement(selectedElement, {
      styling: {
        ...selectedElementData?.styling,
        [property]: value
      }
    });
  };

  // Update overlay text content
  const updateOverlayText = (text: string) => {
    if (!selectedElement || selectedElementData?.type !== 'image') return;

    updateElement(selectedElement, {
      overlay: {
        ...selectedElementData?.overlay,
        text: text
      }
    });
  };

  // Update overlay enabled state
  const updateOverlayEnabled = (enabled: boolean) => {
    if (!selectedElement || selectedElementData?.type !== 'image') return;

    updateElement(selectedElement, {
      overlay: {
        ...selectedElementData?.overlay,
        enabled: enabled
      }
    });
  };

  // Update overlay styling
  const updateOverlayStyling = (property: string, value: string) => {
    if (!selectedElement || selectedElementData?.type !== 'image') return;

    updateElement(selectedElement, {
      overlay: {
        ...selectedElementData?.overlay,
        styling: {
          ...selectedElementData?.overlay?.styling,
          [property]: value
        }
      }
    });
  };

  return (
    <div className="space-y-2">
      {/* Content Editor */}
      <Collapsible 
        open={sectionsOpen.contentEditor} 
        onOpenChange={() => toggleSection('contentEditor')}
      >
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Edit3 className="h-4 w-4 mr-2 text-gray-600" />
                  <CardTitle className="text-base font-semibold text-gray-900">Content Editor</CardTitle>
                </div>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.contentEditor ? 'rotate-180' : ''}`} />
              </div>
              <CardDescription className="text-xs text-gray-600">
                Manage your email content and promo details
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-3">
              {/* Email Settings Subsection */}
              <Collapsible 
                open={sectionsOpen.emailSettings} 
                onOpenChange={() => toggleSection('emailSettings')}
              >
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between p-2 bg-gray-50 rounded cursor-pointer hover:bg-gray-100 transition-colors">
                    <h4 className="text-sm font-medium text-gray-900">Email Settings</h4>
                    <ChevronDown className={`h-3 w-3 text-gray-500 transition-transform ${sectionsOpen.emailSettings ? 'rotate-180' : ''}`} />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-3 pt-3 border-b pb-3">
                    <div>
                      <Label htmlFor="emailSubject" className="text-xs font-medium text-gray-700 block mb-1">Subject Line</Label>
                      <Input
                        id="emailSubject"
                        placeholder="Your Amazing Promo Code Inside!"
                        value={currentDesign.content.subject || ''}
                        onChange={(e) => onContentUpdate({ subject: e.target.value })}
                        className="text-sm h-8"
                      />
                      <p className="text-xs text-gray-500 mt-1">Appears in recipient's inbox</p>
                    </div>

                    <div>
                      <Label htmlFor="previewText" className="text-xs font-medium text-gray-700 block mb-1">Preview Text</Label>
                      <Input
                        id="previewText"
                        placeholder="Don't miss out on this exclusive offer..."
                        value={currentDesign.content.previewText || ''}
                        onChange={(e) => onContentUpdate({ previewText: e.target.value })}
                        className="text-sm h-8"
                      />
                      <p className="text-xs text-gray-500 mt-1">Preview text shown in email clients</p>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <Label htmlFor="email" className="text-xs font-medium text-gray-700 block mb-1">Customer Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="customer@example.com"
                    value={currentDesign.content.email || ''}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>

                <div>
                  <Label htmlFor="promoCode" className="text-xs font-medium text-gray-700 block mb-1">Promo Code</Label>
                  <Input
                    id="promoCode"
                    placeholder="SAVE20"
                    value={currentDesign.content.promoCode || ''}
                    onChange={(e) => handlePromoCodeChange(e.target.value)}
                    className="text-sm h-8"
                  />
                </div>

                <div>
                  <Label htmlFor="customMessage" className="text-xs font-medium text-gray-700 block mb-1">
                    Custom Message ({currentDesign.content.customMessage?.length || 0}/1000)
                  </Label>
                  <Textarea
                    id="customMessage"
                    placeholder="Write your personalized message..."
                    value={currentDesign.content.customMessage || ''}
                    onChange={(e) => handleCustomMessageChange(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="text-xs resize-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">This message appears prominently in your email</p>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Element Library */}
      <Collapsible 
        open={sectionsOpen.elementLibrary} 
        onOpenChange={() => toggleSection('elementLibrary')}
      >
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <Grid3x3 className="h-4 w-4 mr-2 text-gray-600" />
                  <CardTitle className="text-base font-semibold text-gray-900">Element Library</CardTitle>
                </div>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.elementLibrary ? 'rotate-180' : ''}`} />
              </div>
              <CardDescription className="text-xs text-gray-600">
                Drag elements to add to your email
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-2">
                {elementTemplates.map((template) => (
                  <Button
                    key={template.id}
                    variant="outline"
                    className="h-auto p-3 flex flex-col items-center space-y-1 hover:bg-gray-50 transition-colors text-center"
                    onClick={() => addElement(template.id)}
                    draggable
                    onDragStart={() => setDraggedElement(template.id)}
                    onDragEnd={() => setDraggedElement(null)}
                  >
                    <template.icon className="h-4 w-4 text-gray-600" />
                    <span className="text-xs font-medium text-gray-700">{template.label}</span>
                  </Button>
                ))}
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Element List */}
      {currentDesign.content.sections.length > 0 && (
        <Collapsible 
          open={sectionsOpen.elementList} 
          onOpenChange={() => toggleSection('elementList')}
        >
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Eye className="h-4 w-4 mr-2 text-gray-600" />
                    <CardTitle className="text-base font-semibold text-gray-900">Email Elements</CardTitle>
                    <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                      {currentDesign.content.sections.length}
                    </span>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.elementList ? 'rotate-180' : ''}`} />
                </div>
                <CardDescription className="text-xs text-gray-600">
                  Manage and edit your email elements
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {currentDesign.content.sections.map((section, index) => (
                    <div
                      key={section.id}
                      className={`p-2 border rounded cursor-pointer transition-all duration-200 ${
                        selectedElement === section.id 
                          ? 'border-blue-500 bg-blue-50' 
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => onElementSelect(section.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Move className="h-3 w-3 text-gray-400" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-gray-900 capitalize">
                              {section.type} #{index + 1}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                              {section.content || 'No content'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingElement(section.id);
                            }}
                          >
                            <Edit3 className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateElement(section.id);
                            }}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="sm"
                            className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteElement(section.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Element Properties Panel */}
      {selectedElementData && (
        <Collapsible 
          open={sectionsOpen.elementProperties} 
          onOpenChange={() => toggleSection('elementProperties')}
        >
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Settings className="h-4 w-4 mr-2 text-gray-600" />
                    <CardTitle className="text-base font-semibold text-gray-900">Element Properties</CardTitle>
                    <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full capitalize">
                      {selectedElementData.type}
                    </span>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.elementProperties ? 'rotate-180' : ''}`} />
                </div>
                <CardDescription className="text-xs text-gray-600">
                  Customize the selected element
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-3">
            {/* Content Editor */}
            {selectedElementData.type !== 'divider' && (
              <div>
                <Label className="text-sm font-medium text-gray-700">Content</Label>
                {selectedElementData.type === 'text' ? (
                  <Textarea
                    value={selectedElementData.content || ''}
                    onChange={(e) => updateElementContent(e.target.value)}
                    placeholder="Enter text content..."
                    rows={3}
                    className="mt-1"
                  />
                ) : selectedElementData.type === 'image' ? (
                  <Input
                    value={selectedElementData.content || ''}
                    onChange={(e) => updateElementContent(e.target.value)}
                    placeholder="Image URL (or upload image below)"
                    className="mt-1"
                  />
                ) : (
                  <Input
                    value={selectedElementData.content || ''}
                    onChange={(e) => updateElementContent(e.target.value)}
                    placeholder={selectedElementData.type === 'button' ? 'Button text' : 'Content'}
                    className="mt-1"
                  />
                )}
              </div>
            )}

            {/* Image Upload Section */}
            {selectedElementData.type === 'image' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">Upload Image</Label>
                  {isUploading && (
                    <div className="text-xs text-blue-600">
                      Uploading... {Math.round(uploadProgress)}%
                    </div>
                  )}
                </div>
                
                <FileUpload
                  fieldName="emailImage"
                  label=""
                  currentFile={null}
                  onFileChange={handleImageUpload}
                  accept=".jpg,.jpeg,.png,.webp"
                  maxSize={4.5}
                  description="JPG, PNG, WebP files (max 4.5MB)"
                  className="border-dashed border-2 border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
                />
                
                {selectedElementData.content && (
                  <div className="mt-3">
                    <Label className="text-sm font-medium text-gray-700 mb-2 block">Current Image Preview</Label>
                    <div className="border rounded-lg p-2 bg-gray-50">
                      <img 
                        src={selectedElementData.content} 
                        alt="Email image preview" 
                        className="max-w-full h-auto max-h-32 object-contain rounded"
                        onError={(e) => {
                          e.currentTarget.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDIwMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMTIwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMDAgNjBMMTIwIDQwSDgwTDEwMCA2MFoiIGZpbGw9IiM5Q0EzQUYiLz4KPHN2Zz4K";
                        }}
                      />
                    </div>
                  </div>
                )}
                
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <Upload className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-blue-700">
                      <strong>Tip:</strong> Upload high-quality images for better email appearance. Images will be automatically optimized for email delivery.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Text Overlay Section for Images */}
            {selectedElementData.type === 'image' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">Text Overlay</Label>
                  <Switch
                    checked={selectedElementData.overlay?.enabled || false}
                    onCheckedChange={updateOverlayEnabled}
                  />
                </div>

                {selectedElementData.overlay?.enabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Overlay Text</Label>
                      <Textarea
                        value={selectedElementData.overlay?.text || ''}
                        onChange={(e) => updateOverlayText(e.target.value)}
                        placeholder="Enter text to display over the image..."
                        rows={2}
                        className="mt-1"
                      />
                    </div>

                    {/* Overlay Text Color */}
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={selectedElementData.overlay?.styling?.color || '#ffffff'}
                          onChange={(e) => updateOverlayStyling('color', e.target.value)}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Input
                          value={selectedElementData.overlay?.styling?.color || '#ffffff'}
                          onChange={(e) => updateOverlayStyling('color', e.target.value)}
                          placeholder="#ffffff"
                          className="flex-1"
                        />
                      </div>
                    </div>

                    {/* Background Color */}
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Background</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={selectedElementData.overlay?.styling?.backgroundColor?.replace('rgba(0, 0, 0, 0.5)', '#000000') || '#000000'}
                          onChange={(e) => {
                            const hex = e.target.value;
                            const rgba = `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, 0.7)`;
                            updateOverlayStyling('backgroundColor', rgba);
                          }}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Select
                          value={selectedElementData.overlay?.styling?.backgroundColor || 'rgba(0, 0, 0, 0.5)'}
                          onValueChange={(value) => updateOverlayStyling('backgroundColor', value)}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="rgba(0, 0, 0, 0.5)">Dark (50%)</SelectItem>
                            <SelectItem value="rgba(0, 0, 0, 0.7)">Dark (70%)</SelectItem>
                            <SelectItem value="rgba(255, 255, 255, 0.7)">Light (70%)</SelectItem>
                            <SelectItem value="rgba(255, 255, 255, 0.9)">Light (90%)</SelectItem>
                            <SelectItem value="transparent">Transparent</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Font Size */}
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Font Size</Label>
                      <Select
                        value={selectedElementData.overlay?.styling?.fontSize || '18px'}
                        onValueChange={(value) => updateOverlayStyling('fontSize', value)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="14px">14px</SelectItem>
                          <SelectItem value="16px">16px</SelectItem>
                          <SelectItem value="18px">18px</SelectItem>
                          <SelectItem value="20px">20px</SelectItem>
                          <SelectItem value="24px">24px</SelectItem>
                          <SelectItem value="28px">28px</SelectItem>
                          <SelectItem value="32px">32px</SelectItem>
                          <SelectItem value="36px">36px</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Font Weight */}
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Font Weight</Label>
                      <Select
                        value={selectedElementData.overlay?.styling?.fontWeight || '600'}
                        onValueChange={(value) => updateOverlayStyling('fontWeight', value)}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="400">Regular (400)</SelectItem>
                          <SelectItem value="500">Medium (500)</SelectItem>
                          <SelectItem value="600">Semi-bold (600)</SelectItem>
                          <SelectItem value="700">Bold (700)</SelectItem>
                          <SelectItem value="800">Extra Bold (800)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-start space-x-2">
                    <Type className="h-4 w-4 text-purple-600 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-purple-700">
                      <strong>Text Overlay:</strong> Add text on top of your images to create compelling call-to-action messages or promotional content.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Styling Options */}
            <div className="space-y-3">
              <h4 className="font-medium text-gray-900">Styling</h4>

              {/* Text Color */}
              <div>
                <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                <div className="flex items-center space-x-2 mt-1">
                  <Input
                    type="color"
                    value={selectedElementData.styling?.color || currentDesign.designSystem.colors.neutral.dark}
                    onChange={(e) => updateElementStyling('color', e.target.value)}
                    className="w-12 h-8 p-1 border rounded"
                  />
                  <Input
                    value={selectedElementData.styling?.color || currentDesign.designSystem.colors.neutral.dark}
                    onChange={(e) => updateElementStyling('color', e.target.value)}
                    placeholder="#000000"
                    className="flex-1"
                  />
                </div>
              </div>

              {/* Background Color (for text and buttons) */}
              {(selectedElementData.type === 'button' || selectedElementData.type === 'text') && (
                <GradientColorPicker
                  value={selectedElementData.styling?.backgroundColor || (selectedElementData.type === 'button' ? currentDesign.designSystem.colors.primary.main : 'transparent')}
                  onChange={(value) => updateElementStyling('backgroundColor', value)}
                  label="Background"
                  allowSolid={true}
                />
              )}

              {/* Advanced Padding Controls */}
              <div className="space-y-3 border-t pt-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">Padding</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Apply global layout padding to this element
                      const globalPadding = currentDesign.designSystem.layout.padding;
                      updateElementStyling('padding', globalPadding);
                    }}
                    className="text-xs"
                  >
                    Use Global
                  </Button>
                </div>
                
                {/* Quick Padding Presets */}
                <div className="grid grid-cols-4 gap-1">
                  {['0px', '8px', '16px', '24px'].map((padding) => (
                    <Button
                      key={padding}
                      variant={selectedElementData.styling?.padding === padding ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => updateElementStyling('padding', padding)}
                      className="text-xs h-8"
                    >
                      {padding}
                    </Button>
                  ))}
                </div>

                {/* Individual Padding Controls */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs text-gray-600">Top</Label>
                    <Input
                      value={selectedElementData.styling?.paddingTop || '8px'}
                      onChange={(e) => updateElementStyling('paddingTop', e.target.value)}
                      placeholder="8px"
                      className="text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Right</Label>
                    <Input
                      value={selectedElementData.styling?.paddingRight || '12px'}
                      onChange={(e) => updateElementStyling('paddingRight', e.target.value)}
                      placeholder="12px"
                      className="text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Bottom</Label>
                    <Input
                      value={selectedElementData.styling?.paddingBottom || '8px'}
                      onChange={(e) => updateElementStyling('paddingBottom', e.target.value)}
                      placeholder="8px"
                      className="text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-600">Left</Label>
                    <Input
                      value={selectedElementData.styling?.paddingLeft || '12px'}
                      onChange={(e) => updateElementStyling('paddingLeft', e.target.value)}
                      placeholder="12px"
                      className="text-xs h-8"
                    />
                  </div>
                </div>

                {/* Margin Controls */}
                <div className="border-t pt-2">
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Margin</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-gray-600">Top</Label>
                      <Input
                        value={selectedElementData.styling?.marginTop || '0px'}
                        onChange={(e) => updateElementStyling('marginTop', e.target.value)}
                        placeholder="0px"
                        className="text-xs h-8"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-gray-600">Bottom</Label>
                      <Input
                        value={selectedElementData.styling?.marginBottom || '16px'}
                        onChange={(e) => updateElementStyling('marginBottom', e.target.value)}
                        placeholder="16px"
                        className="text-xs h-8"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Border Radius - Inherit from Layout */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">Border Radius</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Apply global layout border radius
                      const globalRadius = currentDesign.designSystem.layout.borderRadius;
                      updateElementStyling('borderRadius', globalRadius);
                    }}
                    className="text-xs"
                  >
                    Use Global ({currentDesign.designSystem.layout.borderRadius})
                  </Button>
                </div>
                <Select
                  value={selectedElementData.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius}
                  onValueChange={(value) => updateElementStyling('borderRadius', value)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0px">0px (Square)</SelectItem>
                    <SelectItem value="4px">4px (Slight)</SelectItem>
                    <SelectItem value="8px">8px (Small)</SelectItem>
                    <SelectItem value="12px">12px (Standard)</SelectItem>
                    <SelectItem value="16px">16px (Medium)</SelectItem>
                    <SelectItem value="24px">24px (Large)</SelectItem>
                    <SelectItem value="50%">50% (Pill)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Font Size */}
              {selectedElementData.type !== 'divider' && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Font Size</Label>
                  <Select
                    value={selectedElementData.styling?.fontSize || '16px'}
                    onValueChange={(value) => updateElementStyling('fontSize', value)}
                  >
                    <SelectTrigger className="mt-1">
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
              )}

              {/* Font Weight */}
              {selectedElementData.type !== 'divider' && (
                <div>
                  <Label className="text-sm font-medium text-gray-700">Font Weight</Label>
                  <Select
                    value={selectedElementData.styling?.fontWeight || '400'}
                    onValueChange={(value) => updateElementStyling('fontWeight', value)}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="300">Light (300)</SelectItem>
                      <SelectItem value="400">Regular (400)</SelectItem>
                      <SelectItem value="500">Medium (500)</SelectItem>
                      <SelectItem value="600">Semi-bold (600)</SelectItem>
                      <SelectItem value="700">Bold (700)</SelectItem>
                      <SelectItem value="800">Extra Bold (800)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Text Alignment */}
              <div>
                <Label className="text-sm font-medium text-gray-700">
                  {selectedElementData.type === 'text' ? 'Text Alignment' : 'Element Alignment'}
                </Label>
                <div className="flex items-center space-x-1 mt-1">
                  <Button
                    variant={selectedElementData.styling?.textAlign === 'left' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateElementStyling('textAlign', 'left')}
                  >
                    <AlignLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedElementData.styling?.textAlign === 'center' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateElementStyling('textAlign', 'center')}
                  >
                    <AlignCenter className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={selectedElementData.styling?.textAlign === 'right' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateElementStyling('textAlign', 'right')}
                  >
                    <AlignRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Max Width Constraint - Inherit from Layout */}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium text-gray-700">Max Width</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Apply global layout max width
                      const globalMaxWidth = currentDesign.designSystem.layout.maxWidth;
                      updateElementStyling('maxWidth', globalMaxWidth);
                    }}
                    className="text-xs"
                  >
                    Use Global ({currentDesign.designSystem.layout.maxWidth})
                  </Button>
                </div>
                <Select
                  value={selectedElementData.styling?.maxWidth || '100%'}
                  onValueChange={(value) => updateElementStyling('maxWidth', value)}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="100%">100% (Full Width)</SelectItem>
                    <SelectItem value="480px">480px (Mobile)</SelectItem>
                    <SelectItem value="600px">600px (Standard)</SelectItem>
                    <SelectItem value="800px">800px (Wide)</SelectItem>
                    <SelectItem value="400px">400px (Narrow)</SelectItem>
                    <SelectItem value="300px">300px (Small)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Dimensions for images */}
              {selectedElementData.type === 'image' && (
                <>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Width</Label>
                    <Input
                      value={selectedElementData.styling?.width || '200px'}
                      onChange={(e) => updateElementStyling('width', e.target.value)}
                      placeholder="200px"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Height</Label>
                    <Input
                      value={selectedElementData.styling?.height || '120px'}
                      onChange={(e) => updateElementStyling('height', e.target.value)}
                      placeholder="120px"
                      className="mt-1"
                    />
                  </div>
                </>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex space-x-2 pt-4 border-t">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => duplicateElement(selectedElementData.id)}
              >
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => deleteElement(selectedElementData.id)}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

      {/* Special Elements Editor (Custom Message, Promo Code, Order Button) */}
      {selectedElement && ['custom-message', 'promo-code', 'order-button', 'email-header'].includes(selectedElement) && (
        <Collapsible 
          open={sectionsOpen.specialElements} 
          onOpenChange={() => toggleSection('specialElements')}
        >
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <Paintbrush2 className="h-4 w-4 mr-2 text-gray-600" />
                    <CardTitle className="text-base font-semibold text-gray-900">
                      {selectedElement === 'custom-message' && 'Edit Custom Message'}
                      {selectedElement === 'promo-code' && 'Edit Promo Code'}
                      {selectedElement === 'order-button' && 'Edit Order Button'}
                      {selectedElement === 'email-header' && 'Edit Email Header'}
                    </CardTitle>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.specialElements ? 'rotate-180' : ''}`} />
                </div>
                <CardDescription className="text-xs text-gray-600">
                  Configure this core email element
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-3">
            {selectedElement === 'email-header' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Header Title</Label>
                  <Input
                    value={currentDesign.content.header?.title || 'Local Cooks'}
                    onChange={(e) => handleHeaderTitleChange(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">Header Subtitle</Label>
                  <Input
                    value={currentDesign.content.header?.subtitle || 'Special Offer Inside'}
                    onChange={(e) => handleHeaderSubtitleChange(e.target.value)}
                    className="mt-1"
                  />
                </div>

                {/* Advanced Header Styling */}
                <div className="space-y-3 border-t pt-3">
                  <h4 className="font-medium text-gray-900">Header Styling</h4>
                  
                  {/* Background - Fixed Brand Color */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Background</Label>
                    <div className="mt-1 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div 
                        className="w-full h-8 rounded-md border-2 border-red-300"
                        style={{ background: 'linear-gradient(135deg, #F51042 0%, #FF5470 100%)' }}
                      />
                      <p className="text-xs text-red-700 mt-2">
                        <strong>Brand Color:</strong> Header uses your Local Cooks brand color for consistent branding.
                      </p>
                    </div>
                  </div>

                  {/* Title Color */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Title Color</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        type="color"
                        value={currentDesign.content.header?.styling?.titleColor || '#ffffff'}
                        onChange={(e) => handleHeaderStylingChange('titleColor', e.target.value)}
                        className="w-12 h-8 p-1 border rounded"
                      />
                      <Input
                        value={currentDesign.content.header?.styling?.titleColor || '#ffffff'}
                        onChange={(e) => handleHeaderStylingChange('titleColor', e.target.value)}
                        placeholder="#ffffff"
                        className="flex-1"
                      />
                    </div>
                  </div>

                  {/* Subtitle Color */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Subtitle Color</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        type="color"
                        value={currentDesign.content.header?.styling?.subtitleColor || currentDesign.designSystem.colors.primary.light}
                        onChange={(e) => handleHeaderStylingChange('subtitleColor', e.target.value)}
                        className="w-12 h-8 p-1 border rounded"
                      />
                      <Input
                        value={currentDesign.content.header?.styling?.subtitleColor || currentDesign.designSystem.colors.primary.light}
                        onChange={(e) => handleHeaderStylingChange('subtitleColor', e.target.value)}
                        placeholder="#ff5470"
                        className="flex-1"
                      />
                    </div>
                  </div>

                  {/* Title Font Size */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Title Font Size</Label>
                    <Select
                      value={currentDesign.content.header?.styling?.titleFontSize || '24px'}
                      onValueChange={(value) => handleHeaderStylingChange('titleFontSize', value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="18px">18px</SelectItem>
                        <SelectItem value="20px">20px</SelectItem>
                        <SelectItem value="24px">24px</SelectItem>
                        <SelectItem value="28px">28px</SelectItem>
                        <SelectItem value="32px">32px</SelectItem>
                        <SelectItem value="36px">36px</SelectItem>
                        <SelectItem value="40px">40px</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Text Alignment */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Text Alignment</Label>
                    <div className="flex items-center space-x-1 mt-1">
                      <Button
                        variant={currentDesign.content.header?.styling?.textAlign === 'left' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleHeaderStylingChange('textAlign', 'left')}
                      >
                        <AlignLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={currentDesign.content.header?.styling?.textAlign === 'center' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleHeaderStylingChange('textAlign', 'center')}
                      >
                        <AlignCenter className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={currentDesign.content.header?.styling?.textAlign === 'right' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleHeaderStylingChange('textAlign', 'right')}
                      >
                        <AlignRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Padding */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Padding</Label>
                    <Input
                      value={currentDesign.content.header?.styling?.padding || '16px'}
                      onChange={(e) => handleHeaderStylingChange('padding', e.target.value)}
                      placeholder="16px"
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedElement === 'custom-message' && (
              <div>
                <Label htmlFor="customMessage" className="text-sm font-medium text-gray-700">
                  Custom Message ({currentDesign.content.customMessage?.length || 0}/1000)
                </Label>
                <Textarea
                  id="customMessage"
                  placeholder="Write your personalized message to the customer..."
                  value={currentDesign.content.customMessage || ''}
                  onChange={(e) => handleCustomMessageChange(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  This message will appear prominently in your email template
                </p>
              </div>
            )}

            {selectedElement === 'promo-code' && (
              <div>
                <Label htmlFor="promoCode" className="text-sm font-medium text-gray-700">Promo Code</Label>
                <Input
                  id="promoCode"
                  placeholder="SAVE20"
                  value={currentDesign.content.promoCode || ''}
                  onChange={(e) => handlePromoCodeChange(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Enter the promotional code customers will receive
                </p>
              </div>
            )}

            {selectedElement === 'order-button' && (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Button Text</Label>
                  <Input
                    value={currentDesign.content.orderButton?.text || 'Order Now'}
                    onChange={(e) => handleOrderButtonTextChange(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700">Button Link</Label>
                  <Input
                    value={currentDesign.content.orderButton?.url || 'https://your-website.com/order'}
                    onChange={(e) => handleOrderButtonUrlChange(e.target.value)}
                    className="mt-1"
                  />
                </div>

                {/* Advanced Styling Controls for Order Button */}
                <div className="space-y-3 border-t pt-3">
                  <h4 className="font-medium text-gray-900">Button Styling</h4>
                  
                  {/* Background Color */}
                  <GradientColorPicker
                    value={currentDesign.content.orderButton?.styling?.backgroundColor || currentDesign.designSystem.colors.primary.main}
                    onChange={(value) => handleOrderButtonStylingChange('backgroundColor', value)}
                    label="Background"
                    allowSolid={true}
                  />

                  {/* Text Color */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Text Color</Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        type="color"
                        value={currentDesign.content.orderButton?.styling?.color || currentDesign.designSystem.colors.primary.contrast}
                        onChange={(e) => handleOrderButtonStylingChange('color', e.target.value)}
                        className="w-12 h-8 p-1 border rounded"
                      />
                      <Input
                        value={currentDesign.content.orderButton?.styling?.color || currentDesign.designSystem.colors.primary.contrast}
                        onChange={(e) => handleOrderButtonStylingChange('color', e.target.value)}
                        placeholder="#ffffff"
                        className="flex-1"
                      />
                    </div>
                  </div>

                  {/* Font Size */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Font Size</Label>
                    <Select
                      value={currentDesign.content.orderButton?.styling?.fontSize || '16px'}
                      onValueChange={(value) => handleOrderButtonStylingChange('fontSize', value)}
                    >
                      <SelectTrigger className="mt-1">
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

                  {/* Font Weight */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Font Weight</Label>
                    <Select
                      value={currentDesign.content.orderButton?.styling?.fontWeight || '600'}
                      onValueChange={(value) => handleOrderButtonStylingChange('fontWeight', value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="300">Light (300)</SelectItem>
                        <SelectItem value="400">Regular (400)</SelectItem>
                        <SelectItem value="500">Medium (500)</SelectItem>
                        <SelectItem value="600">Semi-bold (600)</SelectItem>
                        <SelectItem value="700">Bold (700)</SelectItem>
                        <SelectItem value="800">Extra Bold (800)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Button Alignment */}
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Button Alignment</Label>
                    <div className="flex items-center space-x-1 mt-1">
                      <Button
                        variant={currentDesign.content.orderButton?.styling?.textAlign === 'left' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleOrderButtonStylingChange('textAlign', 'left')}
                      >
                        <AlignLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={currentDesign.content.orderButton?.styling?.textAlign === 'center' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleOrderButtonStylingChange('textAlign', 'center')}
                      >
                        <AlignCenter className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={currentDesign.content.orderButton?.styling?.textAlign === 'right' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleOrderButtonStylingChange('textAlign', 'right')}
                      >
                        <AlignRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Padding Controls */}
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-gray-700">Padding</Label>
                    
                    {/* Quick Padding Presets */}
                    <div className="grid grid-cols-4 gap-1">
                      {['8px 16px', '12px 24px', '16px 32px', '20px 40px'].map((padding) => (
                        <Button
                          key={padding}
                          variant={currentDesign.content.orderButton?.styling?.padding === padding ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => handleOrderButtonStylingChange('padding', padding)}
                          className="text-xs h-8"
                        >
                          {padding.split(' ')[0]}
                        </Button>
                      ))}
                    </div>

                    {/* Custom Padding Input */}
                    <Input
                      value={currentDesign.content.orderButton?.styling?.padding || '12px 24px'}
                      onChange={(e) => handleOrderButtonStylingChange('padding', e.target.value)}
                      placeholder="12px 24px"
                      className="text-sm"
                    />
                    <p className="text-xs text-gray-500">
                      Use CSS padding format: "top/bottom left/right" or "top right bottom left"
                    </p>
                  </div>

                  {/* Border Radius */}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-700">Border Radius</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const globalRadius = currentDesign.designSystem.layout.borderRadius;
                          handleOrderButtonStylingChange('borderRadius', globalRadius);
                        }}
                        className="text-xs"
                      >
                        Use Global ({currentDesign.designSystem.layout.borderRadius})
                      </Button>
                    </div>
                    <Select
                      value={currentDesign.content.orderButton?.styling?.borderRadius || currentDesign.designSystem.layout.borderRadius}
                      onValueChange={(value) => handleOrderButtonStylingChange('borderRadius', value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0px">0px (Square)</SelectItem>
                        <SelectItem value="4px">4px (Slight)</SelectItem>
                        <SelectItem value="8px">8px (Small)</SelectItem>
                        <SelectItem value="12px">12px (Standard)</SelectItem>
                        <SelectItem value="16px">16px (Medium)</SelectItem>
                        <SelectItem value="24px">24px (Large)</SelectItem>
                        <SelectItem value="50px">50px (Pill)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-700">
                <strong>Advanced Mode:</strong> All core email components are fully customizable including text, URLs, colors, and styling.
              </p>
            </div>

            <div className="flex space-x-2 pt-4 border-t">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onElementSelect(null)}
              >
                <MousePointer className="h-4 w-4 mr-2" />
                Deselect
              </Button>
            </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        )}

      {/* Design System Integration */}
      <Collapsible 
        open={sectionsOpen.quickActions} 
        onOpenChange={() => toggleSection('quickActions')}
      >
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <RotateCcw className="h-4 w-4 mr-2 text-gray-600" />
                  <CardTitle className="text-base font-semibold text-gray-900">Quick Actions</CardTitle>
                </div>
                <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${sectionsOpen.quickActions ? 'rotate-180' : ''}`} />
              </div>
              <CardDescription className="text-xs text-gray-600">
                Design system integration and shortcuts
              </CardDescription>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-2">
          <Button 
            variant="outline" 
            className="w-full justify-start"
            onClick={() => {
              // Apply brand colors to all elements
              const updatedSections = currentDesign.content.sections.map(section => ({
                ...section,
                styling: {
                  ...section.styling,
                  color: section.type === 'button' 
                    ? currentDesign.designSystem.colors.primary.contrast
                    : currentDesign.designSystem.colors.neutral.dark,
                  backgroundColor: section.type === 'button' 
                    ? currentDesign.designSystem.colors.primary.main
                    : section.styling?.backgroundColor
                }
              }));

              onContentUpdate({ sections: updatedSections });
              
              toast({
                title: "Brand Colors Applied",
                description: "All elements updated with brand colors",
              });
            }}
          >
            <Paintbrush2 className="h-4 w-4 mr-2" />
            Apply Brand Colors
          </Button>

          <Button 
            variant="outline" 
            className="w-full justify-start"
            onClick={() => {
              // Apply global layout settings to all elements
              const layoutConfig = currentDesign.designSystem.layout;
              const updatedSections = currentDesign.content.sections.map(section => ({
                ...section,
                styling: {
                  ...section.styling,
                  borderRadius: layoutConfig.borderRadius,
                  maxWidth: layoutConfig.maxWidth,
                  padding: section.styling?.padding || layoutConfig.padding,
                  // Apply responsive constraints
                  ...(section.type === 'text' && {
                    paddingTop: section.styling?.paddingTop || '8px',
                    paddingBottom: section.styling?.paddingBottom || '8px',
                    paddingLeft: section.styling?.paddingLeft || layoutConfig.padding,
                    paddingRight: section.styling?.paddingRight || layoutConfig.padding,
                  }),
                  ...(section.type === 'button' && {
                    paddingTop: section.styling?.paddingTop || '12px',
                    paddingBottom: section.styling?.paddingBottom || '12px',
                    paddingLeft: section.styling?.paddingLeft || '24px',
                    paddingRight: section.styling?.paddingRight || '24px',
                  }),
                  ...(section.type === 'image' && {
                    borderRadius: layoutConfig.borderRadius,
                    maxWidth: section.styling?.maxWidth || '100%',
                  })
                }
              }));

              onContentUpdate({ sections: updatedSections });
              
              toast({
                title: "Layout Applied",
                description: "All elements updated with global layout settings",
              });
            }}
          >
            <Grid3x3 className="h-4 w-4 mr-2" />
            Apply Layout to All
          </Button>

          <Button 
            variant="outline" 
            className="w-full justify-start"
            onClick={() => {
              // Reset all elements to default styling
              const updatedSections = currentDesign.content.sections.map(section => {
                const template = elementTemplates.find(t => t.id === section.type);
                return {
                  ...section,
                  styling: template?.template.styling || section.styling
                };
              });

              onContentUpdate({ sections: updatedSections });
              onElementSelect(null);
              
              toast({
                title: "Design Reset",
                description: "All elements reset to default styling",
              });
            }}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset All Elements
          </Button>

          <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="font-semibold text-blue-900 mb-2">
              Tips
            </h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• Click elements in the preview to select them</li>
              <li>• Use the element library to add new components</li>
              <li>• Customize colors and fonts using the properties panel</li>
              <li>• Apply brand colors for consistent styling</li>
            </ul>
          </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}; 