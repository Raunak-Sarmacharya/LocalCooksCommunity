import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Palette, RotateCw } from "lucide-react";
import React, { useCallback, useState } from 'react';

interface GradientColorPickerProps {
  value?: string;
  onChange: (value: string) => void;
  label: string;
  allowSolid?: boolean;
}

export const GradientColorPicker: React.FC<GradientColorPickerProps> = ({
  value = '#000000',
  onChange,
  label,
  allowSolid = true
}) => {
  // State for gradient configuration
  const [isGradient, setIsGradient] = useState(value.includes('gradient'));
  const [color1, setColor1] = useState('#F51042');
  const [color2, setColor2] = useState('#FF5470');
  const [color3, setColor3] = useState('#FF8A9B');
  const [direction, setDirection] = useState('135deg');
  const [solidColor, setSolidColor] = useState('#F51042');

  // Parse existing gradient or solid color
  React.useEffect(() => {
    if (value.includes('gradient')) {
      setIsGradient(true);
      // Try to extract colors from existing gradient
      const colorMatches = value.match(/#[0-9A-Fa-f]{6}/g);
      if (colorMatches) {
        setColor1(colorMatches[0] || '#F51042');
        setColor2(colorMatches[1] || '#FF5470');
        setColor3(colorMatches[2] || '#FF8A9B');
      }
      // Extract direction
      const directionMatch = value.match(/(\d+deg)/);
      if (directionMatch) {
        setDirection(directionMatch[1]);
      }
    } else {
      setIsGradient(false);
      setSolidColor(value);
    }
  }, [value]);

  // Generate gradient string
  const generateGradient = useCallback((c1: string, c2: string, c3: string, dir: string) => {
    return `linear-gradient(${dir}, ${c1} 0%, ${c2} 50%, ${c3} 100%)`;
  }, []);

  // Handle color changes
  const handleColorChange = useCallback((colorIndex: number, newColor: string) => {
    const colors = [color1, color2, color3];
    colors[colorIndex] = newColor;
    
    setColor1(colors[0]);
    setColor2(colors[1]);
    setColor3(colors[2]);
    
    if (isGradient) {
      onChange(generateGradient(colors[0], colors[1], colors[2], direction));
    }
  }, [color1, color2, color3, direction, isGradient, onChange, generateGradient]);

  // Handle direction change
  const handleDirectionChange = useCallback((newDirection: string) => {
    setDirection(newDirection);
    if (isGradient) {
      onChange(generateGradient(color1, color2, color3, newDirection));
    }
  }, [color1, color2, color3, isGradient, onChange, generateGradient]);

  // Handle gradient toggle
  const handleGradientToggle = useCallback((gradient: boolean) => {
    setIsGradient(gradient);
    if (gradient) {
      onChange(generateGradient(color1, color2, color3, direction));
    } else {
      onChange(solidColor);
    }
  }, [color1, color2, color3, direction, solidColor, onChange, generateGradient]);

  // Handle solid color change
  const handleSolidColorChange = useCallback((newColor: string) => {
    setSolidColor(newColor);
    if (!isGradient) {
      onChange(newColor);
    }
  }, [isGradient, onChange]);

  // Preset gradients
  const presetGradients = [
    { name: 'Local Cooks', gradient: generateGradient('#F51042', '#FF5470', '#FF8A9B', '135deg') },
    { name: 'Ocean', gradient: generateGradient('#0066CC', '#0099FF', '#66CCFF', '135deg') },
    { name: 'Sunset', gradient: generateGradient('#FF6B35', '#FF8E35', '#FFB135', '135deg') },
    { name: 'Forest', gradient: generateGradient('#228B22', '#32CD32', '#90EE90', '135deg') },
    { name: 'Purple Dream', gradient: generateGradient('#8A2BE2', '#9370DB', '#DDA0DD', '135deg') },
    { name: 'Fire', gradient: generateGradient('#DC143C', '#FF4500', '#FF6347', '135deg') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium text-gray-700">{label}</Label>
        {allowSolid && (
          <div className="flex items-center space-x-2">
            <Label className="text-xs text-gray-600">Gradient</Label>
            <Switch
              checked={isGradient}
              onCheckedChange={handleGradientToggle}
            />
          </div>
        )}
      </div>

      {/* Preview */}
      <div 
        className="w-full h-12 rounded-lg border shadow-sm"
        style={{ 
          background: isGradient 
            ? generateGradient(color1, color2, color3, direction)
            : solidColor 
        }}
      />

      {isGradient ? (
        <>
          {/* Three Color Inputs */}
          <div className="grid grid-cols-3 gap-2">
            {[color1, color2, color3].map((color, index) => (
              <div key={index}>
                <Label className="text-xs text-gray-600">Color {index + 1}</Label>
                <div className="flex items-center space-x-1 mt-1">
                  <Input
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(index, e.target.value)}
                    className="w-8 h-8 p-1 border rounded"
                  />
                  <Input
                    value={color}
                    onChange={(e) => handleColorChange(index, e.target.value)}
                    placeholder="#000000"
                    className="flex-1 text-xs"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Direction Control */}
          <div>
            <Label className="text-xs text-gray-600">Direction</Label>
            <div className="flex items-center space-x-2 mt-1">
              <Select value={direction} onValueChange={handleDirectionChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0deg">Top to Bottom (0°)</SelectItem>
                  <SelectItem value="45deg">Top Left to Bottom Right (45°)</SelectItem>
                  <SelectItem value="90deg">Left to Right (90°)</SelectItem>
                  <SelectItem value="135deg">Bottom Left to Top Right (135°)</SelectItem>
                  <SelectItem value="180deg">Bottom to Top (180°)</SelectItem>
                  <SelectItem value="225deg">Bottom Right to Top Left (225°)</SelectItem>
                  <SelectItem value="270deg">Right to Left (270°)</SelectItem>
                  <SelectItem value="315deg">Top Right to Bottom Left (315°)</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const currentDeg = parseInt(direction);
                  const newDeg = (currentDeg + 45) % 360;
                  handleDirectionChange(`${newDeg}deg`);
                }}
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Preset Gradients */}
          <div>
            <Label className="text-xs text-gray-600">Presets</Label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {presetGradients.map((preset, index) => (
                <Button
                  key={index}
                  variant="outline"
                  size="sm"
                  className="h-8 p-1 overflow-hidden"
                  onClick={() => onChange(preset.gradient)}
                >
                  <div
                    className="w-full h-full rounded flex items-center justify-center"
                    style={{ background: preset.gradient }}
                  >
                    <span className="text-xs font-medium text-white mix-blend-difference">
                      {preset.name}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Solid Color Input */
        <div className="flex items-center space-x-2">
          <Input
            type="color"
            value={solidColor}
            onChange={(e) => handleSolidColorChange(e.target.value)}
            className="w-12 h-8 p-1 border rounded"
          />
          <Input
            value={solidColor}
            onChange={(e) => handleSolidColorChange(e.target.value)}
            placeholder="#000000"
            className="flex-1"
          />
        </div>
      )}

      <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-start space-x-2">
          <Palette className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            <strong>Tip:</strong> {isGradient 
              ? 'Create beautiful 3-color gradients for stunning backgrounds. Gradients work in most email clients.'
              : 'Use solid colors for maximum email client compatibility.'
            }
          </p>
        </div>
      </div>
    </div>
  );
}; 