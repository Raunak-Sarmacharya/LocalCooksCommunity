import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
    Check,
    Copy,
    Palette,
    RefreshCw,
    Wand2
} from "lucide-react";
import React, { useCallback, useState } from 'react';

// Interface definitions
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

export interface ColorPaletteProps {
  colorSystem: ColorSystemConfig;
  onColorSystemUpdate: (colorSystem: ColorSystemConfig) => void;
}

// Brand Palettes
const BRAND_PALETTES = {
  apple: {
    name: "Apple",
    description: "Clean, minimalist design system",
    colors: {
      primary: { main: "#007AFF", light: "#66B6FF", dark: "#0056B3", contrast: "#FFFFFF" },
      secondary: { main: "#8E8E93", light: "#C7C7CC", dark: "#636366", contrast: "#FFFFFF" },
      accent: { main: "#FF9500", light: "#FFB84D", dark: "#CC7700", contrast: "#FFFFFF" },
      neutral: { main: "#6D6D70", light: "#F2F2F7", dark: "#1C1C1E", contrast: "#FFFFFF" },
      semantic: { success: "#34C759", warning: "#FF9500", error: "#FF3B30", info: "#007AFF" },
      gradients: {
        primary: "linear-gradient(135deg, #007AFF 0%, #66B6FF 100%)",
        secondary: "linear-gradient(135deg, #8E8E93 0%, #C7C7CC 100%)",
        accent: "linear-gradient(135deg, #FF9500 0%, #FFB84D 100%)"
      }
    }
  },
  stripe: {
    name: "Stripe",
    description: "Professional fintech design",
    colors: {
      primary: { main: "#635BFF", light: "#9A96FF", dark: "#453ECC", contrast: "#FFFFFF" },
      secondary: { main: "#87BBFD", light: "#B5D4FE", dark: "#5A8BCA", contrast: "#FFFFFF" },
      accent: { main: "#00D924", light: "#4DED57", dark: "#00A71D", contrast: "#FFFFFF" },
      neutral: { main: "#6B7280", light: "#F9FAFB", dark: "#111827", contrast: "#FFFFFF" },
      semantic: { success: "#00D924", warning: "#F59E0B", error: "#EF4444", info: "#635BFF" },
      gradients: {
        primary: "linear-gradient(135deg, #635BFF 0%, #9A96FF 100%)",
        secondary: "linear-gradient(135deg, #87BBFD 0%, #B5D4FE 100%)",
        accent: "linear-gradient(135deg, #00D924 0%, #4DED57 100%)"
      }
    }
  },
  netflix: {
    name: "Netflix",
    description: "Bold entertainment brand",
    colors: {
      primary: { main: "#E50914", light: "#F24250", dark: "#B20710", contrast: "#FFFFFF" },
      secondary: { main: "#564D4D", light: "#8A7F7F", dark: "#3A3131", contrast: "#FFFFFF" },
      accent: { main: "#F5F5F1", light: "#FFFFFF", dark: "#C2C2BE", contrast: "#000000" },
      neutral: { main: "#6B7280", light: "#F9FAFB", dark: "#111827", contrast: "#FFFFFF" },
      semantic: { success: "#10B981", warning: "#F59E0B", error: "#E50914", info: "#3B82F6" },
      gradients: {
        primary: "linear-gradient(135deg, #E50914 0%, #F24250 100%)",
        secondary: "linear-gradient(135deg, #564D4D 0%, #8A7F7F 100%)",
        accent: "linear-gradient(135deg, #F5F5F1 0%, #FFFFFF 100%)"
      }
    }
  },
  shopify: {
    name: "Shopify",
    description: "E-commerce optimized colors",
    colors: {
      primary: { main: "#7AB55C", light: "#9CC788", dark: "#5E8A46", contrast: "#FFFFFF" },
      secondary: { main: "#5A6C7D", light: "#8A9BAC", dark: "#45525E", contrast: "#FFFFFF" },
      accent: { main: "#6371C7", light: "#8A96E3", dark: "#4C5AA5", contrast: "#FFFFFF" },
      neutral: { main: "#6B7280", light: "#F3F4F6", dark: "#1F2937", contrast: "#FFFFFF" },
      semantic: { success: "#7AB55C", warning: "#F59E0B", error: "#EF4444", info: "#6371C7" },
      gradients: {
        primary: "linear-gradient(135deg, #7AB55C 0%, #9CC788 100%)",
        secondary: "linear-gradient(135deg, #5A6C7D 0%, #8A9BAC 100%)",
        accent: "linear-gradient(135deg, #6371C7 0%, #8A96E3 100%)"
      }
    }
  },
  localcooks: {
    name: "Local Cooks",
    description: "Food & hospitality brand",
    colors: {
      primary: { main: "#16a34a", light: "#4ade80", dark: "#15803d", contrast: "#ffffff" },
      secondary: { main: "#F51042", light: "#FF5470", dark: "#C20D35", contrast: "#ffffff" },
      accent: { main: "#f59e0b", light: "#fbbf24", dark: "#d97706", contrast: "#ffffff" },
      neutral: { main: "#6b7280", light: "#f3f4f6", dark: "#1f2937", contrast: "#ffffff" },
      semantic: { success: "#16a34a", warning: "#f59e0b", error: "#dc2626", info: "#2563eb" },
      gradients: {
        primary: "linear-gradient(135deg, #16a34a 0%, #4ade80 100%)",
        secondary: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
        accent: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)"
      }
    }
  }
};

// Color harmony algorithms
const generateColorHarmony = (baseColor: string, type: 'complementary' | 'triadic' | 'analogous' | 'monochromatic') => {
  // Convert hex to HSL for calculations
  const hexToHsl = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }

    return [h * 360, s * 100, l * 100];
  };

  // Convert HSL back to hex
  const hslToHex = (h: number, s: number, l: number) => {
    h /= 360; s /= 100; l /= 100;

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (c: number) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const [h, s, l] = hexToHsl(baseColor);

  switch (type) {
    case 'complementary':
      return [
        baseColor,
        hslToHex((h + 180) % 360, s, l)
      ];
    case 'triadic':
      return [
        baseColor,
        hslToHex((h + 120) % 360, s, l),
        hslToHex((h + 240) % 360, s, l)
      ];
    case 'analogous':
      return [
        hslToHex((h - 30 + 360) % 360, s, l),
        baseColor,
        hslToHex((h + 30) % 360, s, l)
      ];
    case 'monochromatic':
      return [
        hslToHex(h, s, Math.max(10, l - 30)),
        hslToHex(h, s, Math.max(10, l - 15)),
        baseColor,
        hslToHex(h, s, Math.min(90, l + 15)),
        hslToHex(h, s, Math.min(90, l + 30))
      ];
    default:
      return [baseColor];
  }
};

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  colorSystem,
  onColorSystemUpdate
}) => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('palettes');
  const [selectedBrandPalette, setSelectedBrandPalette] = useState<string | null>(null);
  const [customBaseColor, setCustomBaseColor] = useState('#16a34a');
  const [harmonyType, setHarmonyType] = useState<'complementary' | 'triadic' | 'analogous' | 'monochromatic'>('complementary');
  const [generatedColors, setGeneratedColors] = useState<string[]>([]);
  const [copiedColor, setCopiedColor] = useState<string | null>(null);

  // Apply brand palette
  const applyBrandPalette = useCallback((paletteKey: string) => {
    const palette = BRAND_PALETTES[paletteKey as keyof typeof BRAND_PALETTES];
    if (!palette) return;

    setSelectedBrandPalette(paletteKey);
    onColorSystemUpdate(palette.colors);

    toast({
      title: `${palette.name} Palette Applied`,
      description: palette.description,
    });
  }, [onColorSystemUpdate, toast]);

  // Generate color harmony
  const generateHarmony = useCallback(() => {
    const colors = generateColorHarmony(customBaseColor, harmonyType);
    setGeneratedColors(colors);

    toast({
      title: "Color Harmony Generated",
      description: `Generated ${colors.length} ${harmonyType} colors`,
    });
  }, [customBaseColor, harmonyType, toast]);

  // Copy color to clipboard
  const copyColor = useCallback(async (color: string) => {
    try {
      await navigator.clipboard.writeText(color);
      setCopiedColor(color);
      setTimeout(() => setCopiedColor(null), 2000);

      toast({
        title: "Color Copied",
        description: `${color} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy color to clipboard",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Update individual color
  const updateColor = useCallback((category: keyof ColorSystemConfig, property: string, value: string) => {
    const updatedColorSystem = {
      ...colorSystem,
      [category]: {
        ...colorSystem[category],
        [property]: value
      }
    };

    onColorSystemUpdate(updatedColorSystem);

    toast({
      title: "Color Updated",
      description: `${category} ${property} updated`,
    });
  }, [colorSystem, onColorSystemUpdate, toast]);

  // Generate gradient from two colors
  const generateGradient = (color1: string, color2: string, direction = '135deg') => {
    return `linear-gradient(${direction}, ${color1} 0%, ${color2} 100%)`;
  };

  // Update gradient
  const updateGradient = useCallback((gradientKey: keyof GradientCollection, color1: string, color2: string) => {
    const newGradient = generateGradient(color1, color2);
    
    const updatedColorSystem = {
      ...colorSystem,
      gradients: {
        ...colorSystem.gradients,
        [gradientKey]: newGradient
      }
    };

    onColorSystemUpdate(updatedColorSystem);

    toast({
      title: "Gradient Updated",
      description: `${gradientKey} gradient updated`,
    });
  }, [colorSystem, onColorSystemUpdate, toast]);

  // Apply generated color to palette
  const applyGeneratedColor = useCallback((color: string, target: string) => {
    const [category, property] = target.split('.');
    updateColor(category as keyof ColorSystemConfig, property, color);
  }, [updateColor]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center text-gray-900">
            <Palette className="h-5 w-5 mr-2" />
                    Color System
      </CardTitle>
      <CardDescription>
        Advanced color management and design tools
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 bg-white shadow-sm">
          <TabsTrigger value="palettes">Brand Palettes</TabsTrigger>
          <TabsTrigger value="harmony">Color Harmony</TabsTrigger>
          <TabsTrigger value="custom">Custom Colors</TabsTrigger>
          <TabsTrigger value="gradients">Gradients</TabsTrigger>
        </TabsList>

        <TabsContent value="palettes" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-900">Brand Palettes</CardTitle>
              <CardDescription>
                Professionally designed color systems from top brands
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {Object.entries(BRAND_PALETTES).map(([key, palette]) => (
                <div 
                  key={key}
                  className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedBrandPalette === key 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => applyBrandPalette(key)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="font-semibold text-gray-900">{palette.name}</h4>
                      <p className="text-sm text-gray-600">{palette.description}</p>
                    </div>
                    {selectedBrandPalette === key && (
                      <Badge variant="default" className="bg-blue-600">
                        <Check className="h-3 w-3 mr-1" />
                        Active
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex space-x-2">
                    <div 
                      className="w-8 h-8 rounded border"
                      style={{ backgroundColor: palette.colors.primary.main }}
                      title={`Primary: ${palette.colors.primary.main}`}
                    />
                    <div 
                      className="w-8 h-8 rounded border"
                      style={{ backgroundColor: palette.colors.secondary.main }}
                      title={`Secondary: ${palette.colors.secondary.main}`}
                    />
                    <div 
                      className="w-8 h-8 rounded border"
                      style={{ backgroundColor: palette.colors.accent.main }}
                      title={`Accent: ${palette.colors.accent.main}`}
                    />
                    <div 
                      className="w-8 h-8 rounded border"
                      style={{ backgroundColor: palette.colors.neutral.dark }}
                      title={`Neutral: ${palette.colors.neutral.dark}`}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="harmony" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-900">Color Harmony Generator</CardTitle>
              <CardDescription>
                Generate color combinations using color theory
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Base Color</Label>
                  <div className="flex items-center space-x-2 mt-1">
                    <Input
                      type="color"
                      value={customBaseColor}
                      onChange={(e) => setCustomBaseColor(e.target.value)}
                      className="w-12 h-10 p-1 border rounded"
                    />
                    <Input
                      value={customBaseColor}
                      onChange={(e) => setCustomBaseColor(e.target.value)}
                      placeholder="#16a34a"
                      className="flex-1"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700">Harmony Type</Label>
                  <Select value={harmonyType} onValueChange={(value: any) => setHarmonyType(value)}>
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="complementary">Complementary</SelectItem>
                      <SelectItem value="triadic">Triadic</SelectItem>
                      <SelectItem value="analogous">Analogous</SelectItem>
                      <SelectItem value="monochromatic">Monochromatic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={generateHarmony} className="w-full">
                <Wand2 className="h-4 w-4 mr-2" />
                Generate Color Harmony
              </Button>

              {generatedColors.length > 0 && (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-900">Generated Colors</h4>
                  <div className="grid grid-cols-5 gap-2">
                    {generatedColors.map((color, index) => (
                      <div
                        key={index}
                        className="relative group cursor-pointer"
                        onClick={() => copyColor(color)}
                      >
                        <div 
                          className="w-full h-12 rounded border shadow-sm group-hover:scale-105 transition-transform"
                          style={{ backgroundColor: color }}
                        />
                        <p className="text-xs text-center mt-1 text-gray-600 font-mono">
                          {color}
                        </p>
                        {copiedColor === color && (
                          <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full p-1">
                            <Check className="h-3 w-3" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Select onValueChange={(value) => applyGeneratedColor(generatedColors[0], value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Apply to..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="primary.main">Primary Main</SelectItem>
                        <SelectItem value="secondary.main">Secondary Main</SelectItem>
                        <SelectItem value="accent.main">Accent Main</SelectItem>
                        <SelectItem value="neutral.main">Neutral Main</SelectItem>
                      </SelectContent>
                    </Select>

                    <Button variant="outline" onClick={() => setGeneratedColors([])}>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Clear
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="custom" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-900">Custom Color Editor</CardTitle>
              <CardDescription>
                Fine-tune individual colors in your design system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Primary Colors */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Primary Colors</h4>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(colorSystem.primary).map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-sm font-medium text-gray-700 capitalize">{key}</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={value}
                          onChange={(e) => updateColor('primary', key, e.target.value)}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Input
                          value={value}
                          onChange={(e) => updateColor('primary', key, e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyColor(value)}
                        >
                          {copiedColor === value ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Secondary Colors */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Secondary Colors</h4>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(colorSystem.secondary).map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-sm font-medium text-gray-700 capitalize">{key}</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={value}
                          onChange={(e) => updateColor('secondary', key, e.target.value)}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Input
                          value={value}
                          onChange={(e) => updateColor('secondary', key, e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyColor(value)}
                        >
                          {copiedColor === value ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Accent Colors */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Accent Colors</h4>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(colorSystem.accent).map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-sm font-medium text-gray-700 capitalize">{key}</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={value}
                          onChange={(e) => updateColor('accent', key, e.target.value)}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Input
                          value={value}
                          onChange={(e) => updateColor('accent', key, e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyColor(value)}
                        >
                          {copiedColor === value ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Semantic Colors */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">Semantic Colors</h4>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(colorSystem.semantic).map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-sm font-medium text-gray-700 capitalize">{key}</Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          type="color"
                          value={value}
                          onChange={(e) => updateColor('semantic', key, e.target.value)}
                          className="w-12 h-8 p-1 border rounded"
                        />
                        <Input
                          value={value}
                          onChange={(e) => updateColor('semantic', key, e.target.value)}
                          className="flex-1 font-mono text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyColor(value)}
                        >
                          {copiedColor === value ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gradients" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base text-gray-900">Gradient Studio</CardTitle>
              <CardDescription>
                Create and customize gradient combinations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries(colorSystem.gradients).map(([key, gradient]) => (
                <div key={key}>
                  <Label className="text-sm font-medium text-gray-700 capitalize mb-2 block">
                    {key} Gradient
                  </Label>
                  
                  <div className="space-y-3">
                    {/* Gradient Preview */}
                    <div 
                      className="w-full h-16 rounded border shadow-sm"
                      style={{ background: gradient }}
                    />
                    
                    {/* Gradient CSS */}
                    <div className="flex items-center space-x-2">
                      <Input
                        value={gradient}
                        onChange={(e) => updateGradient(key as keyof GradientCollection, e.target.value, e.target.value)}
                        className="flex-1 font-mono text-sm"
                        placeholder="CSS gradient..."
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyColor(gradient)}
                      >
                        {copiedColor === gradient ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>

                    {/* Quick Gradient Generator */}
                    <div className="grid grid-cols-3 gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateGradient(
                          key as keyof GradientCollection, 
                          colorSystem.primary.main, 
                          colorSystem.primary.light
                        )}
                      >
                        Primary
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateGradient(
                          key as keyof GradientCollection, 
                          colorSystem.secondary.main, 
                          colorSystem.secondary.light
                        )}
                      >
                        Secondary
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateGradient(
                          key as keyof GradientCollection, 
                          colorSystem.accent.main, 
                          colorSystem.accent.light
                        )}
                      >
                        Accent
                      </Button>
                    </div>
                  </div>
                </div>
              ))}

              <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <h4 className="font-semibold text-purple-900 mb-2">
                  Tips
                </h4>
                <ul className="text-sm text-purple-800 space-y-1">
                  <li>• Use subtle gradients for backgrounds</li>
                  <li>• High contrast gradients work well for buttons</li>
                  <li>• Test gradients across different devices</li>
                  <li>• Copy CSS directly to use in custom code</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}; 