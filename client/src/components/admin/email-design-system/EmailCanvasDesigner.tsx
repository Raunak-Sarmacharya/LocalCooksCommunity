import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDragControls } from "framer-motion";
import {
    Crown,
    Eye,
    Image as ImageIcon,
    Layers,
    MousePointer,
    Square,
    Trash2,
    Type,
    Zap
} from "lucide-react";
import React, { useRef, useState } from 'react';

interface EmailCanvasDesignerProps {
  design: any;
  onUpdate: (updates: any) => void;
  previewMode: string;
}

export const EmailCanvasDesigner: React.FC<EmailCanvasDesignerProps> = ({
  design,
  onUpdate,
  previewMode
}) => {
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'text' | 'image' | 'shape'>('select');
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();

  const tools = [
    { id: 'select', label: 'Select', icon: MousePointer },
    { id: 'text', label: 'Text', icon: Type },
    { id: 'image', label: 'Image', icon: ImageIcon },
    { id: 'shape', label: 'Shape', icon: Square }
  ];

  const addElement = (type: string) => {
    const newElement = {
      id: `element-${Date.now()}`,
      type,
      x: 50,
      y: 50,
      width: type === 'text' ? 200 : 100,
      height: type === 'text' ? 40 : 100,
      content: type === 'text' ? 'Click to edit text' : '',
      style: {
        backgroundColor: '#f3f4f6',
        color: '#1f2937',
        fontSize: '16px',
        fontWeight: 'normal',
        borderRadius: '4px',
        padding: '8px'
      }
    };

    onUpdate({
      content: {
        ...design.content,
        elements: [...(design.content.elements || []), newElement]
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-lg">
            <Layers className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">Email Canvas Designer</h2>
            <p className="text-slate-600 dark:text-slate-400">
              Drag-and-drop email builder
            </p>
          </div>
        </div>
        
        <Badge variant="outline" className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <Crown className="h-3 w-3 mr-1" />
          Premium Canvas
        </Badge>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {tools.map((toolItem) => (
                <Button
                  key={toolItem.id}
                  variant={tool === toolItem.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTool(toolItem.id as any)}
                  className="h-10 px-3"
                >
                  <toolItem.icon className="h-4 w-4 mr-2" />
                  {toolItem.label}
                </Button>
              ))}
            </div>
            
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button variant="outline" size="sm">
                <Zap className="h-4 w-4 mr-2" />
                Test Send
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Canvas Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Elements Panel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Elements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button 
              onClick={() => addElement('text')}
              variant="outline" 
              className="w-full justify-start"
            >
              <Type className="h-4 w-4 mr-2" />
              Add Text
            </Button>
            <Button 
              onClick={() => addElement('image')}
              variant="outline" 
              className="w-full justify-start"
            >
              <ImageIcon className="h-4 w-4 mr-2" />
              Add Image
            </Button>
            <Button 
              onClick={() => addElement('button')}
              variant="outline" 
              className="w-full justify-start"
            >
              <Square className="h-4 w-4 mr-2" />
              Add Button
            </Button>
            
            {/* Promo Code Section */}
            <div className="border-t pt-4 mt-4">
              <Label className="text-sm font-medium">Promo Code</Label>
              <div className="space-y-2 mt-2">
                <Input
                  placeholder="Enter promo code"
                  value={design.content.promoCode || ''}
                  onChange={(e) => onUpdate({
                    content: { ...design.content, promoCode: e.target.value }
                  })}
                />
                <Textarea
                  placeholder="Custom message..."
                  rows={3}
                  value={design.content.customMessage || ''}
                  onChange={(e) => onUpdate({
                    content: { ...design.content, customMessage: e.target.value }
                  })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Canvas */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg flex items-center space-x-2">
              <span>Email Canvas</span>
              <Badge variant="secondary" className="text-xs">
                {previewMode}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div 
              ref={canvasRef}
              className={`relative bg-white border-2 border-dashed border-gray-200 rounded-lg overflow-hidden
                ${previewMode === 'mobile' ? 'w-80 h-96' : 
                  previewMode === 'tablet' ? 'w-96 h-80' : 'w-full h-96'}`}
              style={{ minHeight: '600px' }}
            >
              {/* Email Container */}
              <div className="w-full h-full p-6 bg-gradient-to-br from-slate-50 to-slate-100">
                <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg overflow-hidden">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-green-600 to-emerald-600 p-6 text-white">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 bg-white bg-opacity-20 rounded-lg flex items-center justify-center">
                        <span className="text-xl font-bold">LC</span>
                      </div>
                      <div>
                        <h1 className="text-xl font-bold">Local Cooks</h1>
                        <p className="text-green-100">Special Offer Inside</p>
                      </div>
                    </div>
                  </div>

                  {/* Content */}
                  <div className="p-6 space-y-4">
                    <div className="text-center">
                      <h2 className="text-2xl font-bold text-gray-800 mb-2">
                        Exclusive Promo Code!
                      </h2>
                      <p className="text-gray-600">
                        {design.content.customMessage || 'Thank you for being an amazing customer! Here\'s a special offer just for you.'}
                      </p>
                    </div>

                    {/* Promo Code Box - This is what gets customized */}
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-dashed border-green-300 rounded-lg p-6 text-center">
                      <div className="text-sm text-green-600 font-medium mb-2">YOUR PROMO CODE</div>
                      <div className="text-3xl font-bold text-green-700 tracking-wider mb-2">
                        {design.content.promoCode || 'SAVE20'}
                      </div>
                      <div className="text-xs text-green-600">
                        Use this code at checkout
                      </div>
                    </div>

                    {/* CTA Button */}
                    <div className="text-center">
                      <Button className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white px-8 py-3 rounded-lg font-semibold">
                        Order Now & Save
                      </Button>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="bg-gray-50 p-4 text-center text-xs text-gray-500">
                    <p>© 2024 Local Cooks. All rights reserved.</p>
                  </div>
                </div>
              </div>

              {/* Drop Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="w-full h-full border-2 border-transparent hover:border-blue-300 transition-colors" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Properties Panel */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedElement ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-sm">Element Type</Label>
                  <Badge variant="outline" className="ml-2">Text</Badge>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm">Content</Label>
                  <Textarea 
                    placeholder="Edit content..."
                    rows={3}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Width</Label>
                    <Input type="number" placeholder="200" />
                  </div>
                  <div>
                    <Label className="text-xs">Height</Label>
                    <Input type="number" placeholder="40" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Background</Label>
                  <div className="flex space-x-2">
                    <Input type="color" className="w-12 h-8 p-1" />
                    <Input placeholder="#ffffff" className="font-mono text-sm" />
                  </div>
                </div>

                <div className="pt-2 border-t">
                  <Button variant="destructive" size="sm" className="w-full">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Element
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 py-8">
                <MousePointer className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p className="text-sm">Select an element to edit properties</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}; 