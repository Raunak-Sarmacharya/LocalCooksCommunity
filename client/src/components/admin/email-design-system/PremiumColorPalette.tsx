import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import {
    CheckCircle2,
    Copy,
    Crown,
    Droplets,
    Layers,
    Lightbulb,
    Paintbrush,
    Palette,
    Sparkles,
    Star,
    Sun,
    Target,
    Wand2
} from "lucide-react";
import React, { useCallback, useState } from 'react';

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

interface PremiumColorPaletteProps {
  colors: ColorSystemConfig;
  onUpdate: (colors: ColorSystemConfig) => void;
}

export const PremiumColorPalette: React.FC<PremiumColorPaletteProps> = ({
  colors,
  onUpdate
}) => {
  const { toast } = useToast();
  const [activeColorSet, setActiveColorSet] = useState('primary');
  const [colorMode, setColorMode] = useState<'picker' | 'harmony' | 'ai'>('picker');
  const [harmonyType, setHarmonyType] = useState('complementary');
  const [copiedColor, setCopiedColor] = useState<string | null>(null);
  const [customGradient, setCustomGradient] = useState('');

  // Enterprise color palettes inspired by top brands
  const premiumPalettes = [
    {
      name: 'Apple Refined',
      description: 'Clean, minimal sophistication',
      icon: '🍎',
      colors: {
        primary: { main: '#007AFF', light: '#5AC8FA', dark: '#0051D5', contrast: '#FFFFFF' },
        secondary: { main: '#8E8E93', light: '#C7C7CC', dark: '#636366', contrast: '#FFFFFF' },
        accent: { main: '#FF9500', light: '#FFCC02', dark: '#FF6D00', contrast: '#FFFFFF' },
        neutral: { main: '#1C1C1E', light: '#F2F2F7', dark: '#000000', contrast: '#FFFFFF' }
      }
    },
    {
      name: 'Stripe Professional',
      description: 'Trustworthy fintech elegance',
      icon: '💳',
      colors: {
        primary: { main: '#635BFF', light: '#8B5FBF', dark: '#4E46E5', contrast: '#FFFFFF' },
        secondary: { main: '#74788D', light: '#A3A8C3', dark: '#525F7F', contrast: '#FFFFFF' },
        accent: { main: '#00D924', light: '#7CE38B', dark: '#00B020', contrast: '#FFFFFF' },
        neutral: { main: '#32325D', light: '#F6F9FC', dark: '#1A1B23', contrast: '#FFFFFF' }
      }
    },
    {
      name: 'Netflix Bold',
      description: 'Entertainment-grade impact',
      icon: '🎬',
      colors: {
        primary: { main: '#E50914', light: '#F40612', dark: '#B81D24', contrast: '#FFFFFF' },
        secondary: { main: '#221F1F', light: '#564D4D', dark: '#0F0F0F', contrast: '#FFFFFF' },
        accent: { main: '#F5F5F1', light: '#FFFFFF', dark: '#E6E6E1', contrast: '#000000' },
        neutral: { main: '#737373', light: '#CCCCCC', dark: '#404040', contrast: '#FFFFFF' }
      }
    },
    {
      name: 'Shopify Commerce',
      description: 'E-commerce optimized',
      icon: '🛍️',
      colors: {
        primary: { main: '#7AB55C', light: '#96C142', dark: '#5B8A3C', contrast: '#FFFFFF' },
        secondary: { main: '#637381', light: '#919EAB', dark: '#454F5B', contrast: '#FFFFFF' },
        accent: { main: '#FFC107', light: '#FFD54F', dark: '#FFA000', contrast: '#000000' },
        neutral: { main: '#212B36', light: '#F4F6F8', dark: '#161C24', contrast: '#FFFFFF' }
      }
    },
    {
      name: 'Local Cooks Signature',
      description: 'Your brand optimized',
      icon: '👨‍🍳',
      colors: {
        primary: { main: '#F51042', light: '#FF4569', dark: '#D40E3A', contrast: '#FFFFFF' },
        secondary: { main: '#16a34a', light: '#22c55e', dark: '#15803d', contrast: '#FFFFFF' },
        accent: { main: '#f59e0b', light: '#fbbf24', dark: '#d97706', contrast: '#FFFFFF' },
        neutral: { main: '#1f2937', light: '#f9fafb', dark: '#111827', contrast: '#FFFFFF' }
      }
    }
  ];

  // Color harmony algorithms
  const generateHarmony = useCallback((baseColor: string, type: string) => {
    // Convert hex to HSL for calculations
    const hexToHsl = (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      let h, s, l = (max + min) / 2;

      if (max === min) {
        h = s = 0;
      } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = (g - b) / d + (g < b ? 6 : 0); break;
          case g: h = (b - r) / d + 2; break;
          case b: h = (r - g) / d + 4; break;
          default: h = 0;
        }
        h /= 6;
      }

      return [h * 360, s * 100, l * 100];
    };

    const hslToHex = (h: number, s: number, l: number) => {
      h /= 360; s /= 100; l /= 100;
      const a = s * Math.min(l, 1 - l);
      const f = (n: number) => {
        const k = (n + h * 12) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
      };
      return `#${f(0)}${f(8)}${f(4)}`;
    };

    const [h, s, l] = hexToHsl(baseColor);

    switch (type) {
      case 'complementary':
        return [baseColor, hslToHex((h + 180) % 360, s, l)];
      case 'triadic':
        return [
          baseColor,
          hslToHex((h + 120) % 360, s, l),
          hslToHex((h + 240) % 360, s, l)
        ];
      case 'analogous':
        return [
          baseColor,
          hslToHex((h + 30) % 360, s, l),
          hslToHex((h - 30 + 360) % 360, s, l)
        ];
      case 'monochromatic':
        return [
          hslToHex(h, s, Math.max(l - 20, 0)),
          baseColor,
          hslToHex(h, s, Math.min(l + 20, 100))
        ];
      default:
        return [baseColor];
    }
  }, []);

  // Copy color to clipboard
  const copyColor = useCallback(async (color: string) => {
    try {
      await navigator.clipboard.writeText(color);
      setCopiedColor(color);
      toast({
        title: "Color Copied!",
        description: `${color} copied to clipboard`,
      });
      setTimeout(() => setCopiedColor(null), 2000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Unable to copy color to clipboard",
        variant: "destructive"
      });
    }
  }, [toast]);

  // Generate AI-powered color suggestions
  const generateAIColors = useCallback(() => {
    // Simulate AI color generation with sophisticated algorithms
    const aiPalettes = [
      { name: 'Warm Sunset', base: '#FF6B35' },
      { name: 'Ocean Depths', base: '#0077BE' },
      { name: 'Forest Canopy', base: '#228B22' },
      { name: 'Lavender Dreams', base: '#B19CD9' },
      { name: 'Coral Reef', base: '#FF7F7F' }
    ];

    const randomPalette = aiPalettes[Math.floor(Math.random() * aiPalettes.length)];
    const harmony = generateHarmony(randomPalette.base, 'triadic');
    
    toast({
      title: "🤖 AI Colors Generated!",
      description: `Applied "${randomPalette.name}" palette`,
    });

    return {
      primary: { main: harmony[0], light: `${harmony[0]}80`, dark: `${harmony[0]}C0`, contrast: '#FFFFFF' },
      secondary: { main: harmony[1], light: `${harmony[1]}80`, dark: `${harmony[1]}C0`, contrast: '#FFFFFF' },
      accent: { main: harmony[2], light: `${harmony[2]}80`, dark: `${harmony[2]}C0`, contrast: '#FFFFFF' }
    };
  }, [generateHarmony, toast]);

  // Apply premium palette
  const applyPremiumPalette = useCallback((palette: any) => {
    const newColors = {
      ...colors,
      primary: palette.colors.primary,
      secondary: palette.colors.secondary,
      accent: palette.colors.accent,
      neutral: palette.colors.neutral
    };
    
    onUpdate(newColors);
    
    toast({
      title: `${palette.icon} ${palette.name} Applied!`,
      description: palette.description,
    });
  }, [colors, onUpdate, toast]);

  // Update individual color
  const updateColor = useCallback((category: string, type: string, value: string) => {
    const newColors = {
      ...colors,
      [category]: {
        ...colors[category as keyof ColorSystemConfig],
        [type]: value
      }
    };
    onUpdate(newColors);
  }, [colors, onUpdate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-br from-purple-100 to-pink-100 rounded-lg">
            <Palette className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Premium Color System</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Enterprise-grade color design tools
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <Badge variant="outline" className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
            <Crown className="h-3 w-3 mr-1" />
            Pro Studio
          </Badge>
        </div>
      </div>

      {/* Color Mode Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center space-x-2">
            <Wand2 className="h-5 w-5" />
            <span>Color Generation Mode</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={colorMode} onValueChange={(value) => setColorMode(value as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="picker" className="flex items-center space-x-2">
                <Droplets className="h-4 w-4" />
                <span>Manual Picker</span>
              </TabsTrigger>
              <TabsTrigger value="harmony" className="flex items-center space-x-2">
                <Target className="h-4 w-4" />
                <span>Color Harmony</span>
              </TabsTrigger>
              <TabsTrigger value="ai" className="flex items-center space-x-2">
                <Sparkles className="h-4 w-4" />
                <span>AI Generated</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="harmony" className="mt-4">
              <div className="space-y-4">
                <div>
                  <Label>Harmony Type</Label>
                  <Select value={harmonyType} onValueChange={setHarmonyType}>
                    <SelectTrigger>
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
            </TabsContent>

            <TabsContent value="ai" className="mt-4">
              <div className="space-y-4">
                <Button 
                  onClick={() => {
                    const aiColors = generateAIColors();
                    onUpdate({ ...colors, ...aiColors });
                  }}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate AI-Powered Palette
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Premium Palette Library */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center space-x-2">
            <Star className="h-5 w-5" />
            <span>Premium Palette Library</span>
          </CardTitle>
          <CardDescription>
            Curated color systems from leading design companies
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {premiumPalettes.map((palette, index) => (
              <motion.div
                key={palette.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="border rounded-lg p-4 cursor-pointer hover:shadow-lg transition-all duration-200 hover:border-purple-200"
                onClick={() => applyPremiumPalette(palette)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="text-2xl">{palette.icon}</span>
                    <div>
                      <h4 className="font-semibold">{palette.name}</h4>
                      <p className="text-xs text-slate-600">{palette.description}</p>
                    </div>
                  </div>
                </div>
                
                <div className="flex space-x-1 mb-2">
                  {Object.values(palette.colors).map((color: any, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full border border-white shadow-sm"
                      style={{ backgroundColor: color.main }}
                    />
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Color System Editor */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center space-x-2">
            <Layers className="h-5 w-5" />
            <span>Color System Editor</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={activeColorSet} onValueChange={setActiveColorSet}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="primary">Primary</TabsTrigger>
              <TabsTrigger value="secondary">Secondary</TabsTrigger>
              <TabsTrigger value="accent">Accent</TabsTrigger>
              <TabsTrigger value="semantic">Semantic</TabsTrigger>
            </TabsList>

            {['primary', 'secondary', 'accent'].map((colorSet) => (
              <TabsContent key={colorSet} value={colorSet} className="mt-6">
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {['main', 'light', 'dark', 'contrast'].map((variant) => (
                      <div key={variant} className="space-y-3">
                        <Label className="capitalize font-medium">{variant}</Label>
                        <div className="space-y-2">
                                                     <div
                             className="w-full h-16 rounded-lg border-2 border-dashed border-gray-300 cursor-pointer relative group overflow-hidden"
                             style={{ 
                               backgroundColor: (colors[colorSet as keyof ColorSystemConfig] as any)[variant] as string 
                             }}
                             onClick={() => copyColor((colors[colorSet as keyof ColorSystemConfig] as any)[variant] as string)}
                          >
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                              <motion.div
                                initial={{ scale: 0 }}
                                whileHover={{ scale: 1 }}
                                className="p-2 bg-white bg-opacity-90 rounded-full"
                              >
                                                                 {copiedColor === (colors[colorSet as keyof ColorSystemConfig] as any)[variant] ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                                ) : (
                                  <Copy className="h-4 w-4 text-gray-600" />
                                )}
                              </motion.div>
                            </div>
                          </div>
                                                     <Input
                             type="color"
                             value={(colors[colorSet as keyof ColorSystemConfig] as any)[variant] as string}
                             onChange={(e) => updateColor(colorSet, variant, e.target.value)}
                             className="w-full h-8"
                           />
                           <Input
                             type="text"
                             value={(colors[colorSet as keyof ColorSystemConfig] as any)[variant] as string}
                             onChange={(e) => updateColor(colorSet, variant, e.target.value)}
                             className="font-mono text-sm"
                             placeholder="#000000"
                           />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            ))}

            <TabsContent value="semantic" className="mt-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(colors.semantic).map(([type, color]) => (
                  <div key={type} className="space-y-3">
                    <Label className="capitalize font-medium flex items-center space-x-2">
                      <span>{type}</span>
                      {type === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                      {type === 'warning' && <Sun className="h-4 w-4 text-yellow-600" />}
                      {type === 'error' && <Target className="h-4 w-4 text-red-600" />}
                      {type === 'info' && <Lightbulb className="h-4 w-4 text-blue-600" />}
                    </Label>
                    <div className="space-y-2">
                      <div
                        className="w-full h-16 rounded-lg border-2 border-dashed border-gray-300 cursor-pointer relative group overflow-hidden"
                        style={{ backgroundColor: color }}
                        onClick={() => copyColor(color)}
                      >
                        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                          <motion.div
                            initial={{ scale: 0 }}
                            whileHover={{ scale: 1 }}
                            className="p-2 bg-white bg-opacity-90 rounded-full"
                          >
                            {copiedColor === color ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <Copy className="h-4 w-4 text-gray-600" />
                            )}
                          </motion.div>
                        </div>
                      </div>
                      <Input
                        type="color"
                        value={color}
                        onChange={(e) => onUpdate({
                          ...colors,
                          semantic: { ...colors.semantic, [type]: e.target.value }
                        })}
                        className="w-full h-8"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Gradient Studio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center space-x-2">
            <Paintbrush className="h-5 w-5" />
            <span>Gradient Studio</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {Object.entries(colors.gradients).map(([type, gradient]) => (
              <div key={type} className="space-y-2">
                <Label className="capitalize font-medium">{type} Gradient</Label>
                <div className="flex items-center space-x-2">
                  <div
                    className="flex-1 h-12 rounded-lg border"
                    style={{ background: gradient }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyColor(gradient)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}; 