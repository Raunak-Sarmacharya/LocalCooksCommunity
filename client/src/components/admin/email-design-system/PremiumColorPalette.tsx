import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
    Palette,
    RefreshCw
} from "lucide-react";
import React from 'react';

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

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  colorSystem,
  onColorSystemUpdate
}) => {
  const { toast } = useToast();

  const updateColorValue = (category: string, shade: string, value: string) => {
    const updatedColorSystem = {
      ...colorSystem,
      [category]: {
        ...(colorSystem as any)[category],
        [shade]: value
      }
    };
    onColorSystemUpdate(updatedColorSystem);
  };

  const updateGradient = (gradientType: string, value: string) => {
    const updatedColorSystem = {
      ...colorSystem,
      gradients: {
        ...colorSystem.gradients,
        [gradientType]: value
      }
    };
    onColorSystemUpdate(updatedColorSystem);
  };

  const generateGradient = (color1: string, color2: string, direction = '135deg') => {
    return `linear-gradient(${direction}, ${color1} 0%, ${color2} 100%)`;
  };

  const resetToDefault = () => {
    const defaultColors: ColorSystemConfig = {
      primary: { main: "#F51042", light: "#FF5470", dark: "#C20D35", contrast: "#ffffff" },
      secondary: { main: "#000000", light: "#404040", dark: "#000000", contrast: "#ffffff" },
      accent: { main: "#f59e0b", light: "#fbbf24", dark: "#d97706", contrast: "#ffffff" },
      neutral: { main: "#6b7280", light: "#f3f4f6", dark: "#1f2937", contrast: "#ffffff" },
      semantic: { success: "#16a34a", warning: "#f59e0b", error: "#dc2626", info: "#2563eb" },
      gradients: {
        primary: "linear-gradient(135deg, #F51042 0%, #FF5470 100%)",
        secondary: "linear-gradient(135deg, #000000 0%, #404040 100%)",
        accent: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)"
      }
    };
    onColorSystemUpdate(defaultColors);
    toast({
      title: "Colors Reset",
      description: "Color system has been reset to Local Cooks defaults",
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center text-gray-900">
              <Palette className="h-5 w-5 mr-2" />
              Custom Colors
            </CardTitle>
            <CardDescription className="text-sm">
              Customize your brand colors and gradients
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={resetToDefault}
            className="h-8"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            <span className="text-xs">Reset</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary Colors */}
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900 text-sm">Primary Colors</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Main</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.primary.main}
                  onChange={(e) => updateColorValue('primary', 'main', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.primary.main}
                  onChange={(e) => updateColorValue('primary', 'main', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Light</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.primary.light}
                  onChange={(e) => updateColorValue('primary', 'light', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.primary.light}
                  onChange={(e) => updateColorValue('primary', 'light', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Secondary Colors */}
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900 text-sm">Secondary Colors</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Main</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.secondary.main}
                  onChange={(e) => updateColorValue('secondary', 'main', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.secondary.main}
                  onChange={(e) => updateColorValue('secondary', 'main', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Light</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.secondary.light}
                  onChange={(e) => updateColorValue('secondary', 'light', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.secondary.light}
                  onChange={(e) => updateColorValue('secondary', 'light', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Accent Colors */}
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900 text-sm">Accent Colors</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Main</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.accent.main}
                  onChange={(e) => updateColorValue('accent', 'main', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.accent.main}
                  onChange={(e) => updateColorValue('accent', 'main', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Light</Label>
              <div className="flex items-center space-x-2">
                <Input
                  type="color"
                  value={colorSystem.accent.light}
                  onChange={(e) => updateColorValue('accent', 'light', e.target.value)}
                  className="w-10 h-8 p-1 border rounded"
                />
                <Input
                  value={colorSystem.accent.light}
                  onChange={(e) => updateColorValue('accent', 'light', e.target.value)}
                  className="flex-1 text-xs h-8"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Custom Gradients */}
        <div className="space-y-3 border-t pt-3">
          <h4 className="font-medium text-gray-900 text-sm">Custom Gradients</h4>
          <div className="space-y-3">
            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Primary Gradient</Label>
              <div className="flex items-center space-x-2">
                <div 
                  className="w-10 h-8 rounded border"
                  style={{ background: colorSystem.gradients.primary }}
                />
                <Input
                  value={colorSystem.gradients.primary}
                  onChange={(e) => updateGradient('primary', e.target.value)}
                  className="flex-1 text-xs h-8"
                  placeholder="linear-gradient(135deg, #F51042 0%, #FF5470 100%)"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const gradient = generateGradient(colorSystem.primary.main, colorSystem.primary.light);
                    updateGradient('primary', gradient);
                  }}
                  className="h-8 px-2"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Secondary Gradient</Label>
              <div className="flex items-center space-x-2">
                <div 
                  className="w-10 h-8 rounded border"
                  style={{ background: colorSystem.gradients.secondary }}
                />
                <Input
                  value={colorSystem.gradients.secondary}
                  onChange={(e) => updateGradient('secondary', e.target.value)}
                  className="flex-1 text-xs h-8"
                  placeholder="linear-gradient(135deg, #000000 0%, #404040 100%)"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const gradient = generateGradient(colorSystem.secondary.main, colorSystem.secondary.light);
                    updateGradient('secondary', gradient);
                  }}
                  className="h-8 px-2"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-medium text-gray-700 block mb-1">Accent Gradient</Label>
              <div className="flex items-center space-x-2">
                <div 
                  className="w-10 h-8 rounded border"
                  style={{ background: colorSystem.gradients.accent }}
                />
                <Input
                  value={colorSystem.gradients.accent}
                  onChange={(e) => updateGradient('accent', e.target.value)}
                  className="flex-1 text-xs h-8"
                  placeholder="linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const gradient = generateGradient(colorSystem.accent.main, colorSystem.accent.light);
                    updateGradient('accent', gradient);
                  }}
                  className="h-8 px-2"
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> Use the color pickers for quick selection or enter custom hex codes and gradient CSS for precise control.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}; 