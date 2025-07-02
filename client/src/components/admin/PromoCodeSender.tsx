import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
    AlertTriangle,
    CheckCircle,
    Crown,
    Gift,
    Heart,
    Loader2,
    Mail,
    Send,
    TestTube
} from "lucide-react";
import React, { useState } from 'react';

interface PromoEmailData {
  email: string;
  promoCode: string;
  adminMessage: string;
  templateType: 'general' | 'loyalty' | 'comeback';
}

export default function PromoCodeSender() {
  const { toast } = useToast();
  const [formData, setFormData] = useState<PromoEmailData>({
    email: '',
    promoCode: '',
    adminMessage: '',
    templateType: 'general'
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [lastSentEmail, setLastSentEmail] = useState<string | null>(null);

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleTemplateChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      templateType: value as 'general' | 'loyalty' | 'comeback'
    }));
  };

  // Template descriptions for UI
  const getTemplateInfo = (type: string) => {
    switch (type) {
      case 'loyalty':
        return {
          icon: <Crown className="h-4 w-4 text-yellow-600" />,
          title: 'Loyalty Customer',
          description: 'Thank loyal customers for their continued support and orders',
          bgColor: 'bg-yellow-50 border-yellow-200',
          textColor: 'text-yellow-800'
        };
      case 'comeback':
        return {
          icon: <Heart className="h-4 w-4 text-purple-600" />,
          title: 'Welcome Back',
          description: 'Re-engage customers who haven\'t ordered in a while',
          bgColor: 'bg-purple-50 border-purple-200',
          textColor: 'text-purple-800'
        };
      default:
        return {
          icon: <Gift className="h-4 w-4 text-green-600" />,
          title: 'General Promo',
          description: 'Standard promotional email for any customer',
          bgColor: 'bg-green-50 border-green-200',
          textColor: 'text-green-800'
        };
    }
  };

  const validateForm = (): boolean => {
    if (!formData.email.trim()) {
      toast({
        title: "Email Required",
        description: "Please enter a recipient email address.",
        variant: "destructive"
      });
      return false;
    }

    if (!formData.promoCode.trim()) {
      toast({
        title: "Promo Code Required",
        description: "Please enter a promo code to send.",
        variant: "destructive"
      });
      return false;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address.",
        variant: "destructive"
      });
      return false;
    }

    // Promo code validation
    if (formData.promoCode.length < 3 || formData.promoCode.length > 50) {
      toast({
        title: "Invalid Promo Code",
        description: "Promo code must be between 3 and 50 characters.",
        variant: "destructive"
      });
      return false;
    }

    return true;
  };

  const handleSendPromo = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/admin/send-promo-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email.trim(),
          promoCode: formData.promoCode.trim(),
          adminMessage: formData.adminMessage.trim() || undefined,
          templateType: formData.templateType
        })
      });

      const data = await response.json();

      if (response.ok) {
        const templateInfo = getTemplateInfo(formData.templateType);
        toast({
          title: "✅ Promo Email Sent!",
          description: `${templateInfo.title} email with code "${formData.promoCode}" sent to ${formData.email}`,
          variant: "default"
        });
        setLastSentEmail(formData.email);
        
        // Clear form after successful send
        setFormData({
          email: '',
          promoCode: '',
          adminMessage: '',
          templateType: 'general'
        });
      } else {
        toast({
          title: "❌ Failed to Send Email",
          description: data.message || "An error occurred while sending the promo email.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error sending promo email:', error);
      toast({
        title: "❌ Network Error",
        description: "Unable to send promo email. Please check your connection.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTestEmail = async () => {
    setIsTesting(true);
    try {
      const response = await fetch('/api/test-promo-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.email.trim() || 'test@example.com',
          promoCode: formData.promoCode.trim() || 'TEST20',
          adminMessage: formData.adminMessage.trim() || `This is a test ${formData.templateType} promo code email from the admin panel.`,
          templateType: formData.templateType
        })
      });

      const data = await response.json();

      if (response.ok) {
        const templateInfo = getTemplateInfo(formData.templateType);
        toast({
          title: "🧪 Test Email Sent!",
          description: `Test ${templateInfo.title.toLowerCase()} email sent to ${formData.email || 'test@example.com'}`,
          variant: "default"
        });
      } else {
        toast({
          title: "❌ Test Failed",
          description: data.message || "Unable to send test email.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error sending test email:', error);
      toast({
        title: "❌ Test Error",
        description: "Unable to send test email. Please check your connection.",
        variant: "destructive"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const currentTemplateInfo = getTemplateInfo(formData.templateType);

  return (
    <Card className="w-full rounded-xl sm:rounded-2xl border border-gray-200/60 hover:shadow-lg hover:border-gray-300/60 transition-all duration-300 bg-white backdrop-blur-sm">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-lg sm:text-xl font-semibold text-gray-900">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-gradient-to-br from-pink-500 to-red-600 flex items-center justify-center flex-shrink-0">
            <Gift className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
          </div>
          Send Promo Code
        </CardTitle>
        <CardDescription className="text-sm sm:text-base text-gray-500">
          Send exclusive promo codes to users with personalized templates for different customer types.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 sm:space-y-6">
        {/* Email Configuration Alert */}
        <Alert className="bg-blue-50 text-blue-800 border-blue-200">
          <Mail className="h-4 w-4" />
          <AlertTitle>Email System Ready</AlertTitle>
          <AlertDescription>
            Your email system is configured and ready to send promo codes. 
            Choose from different templates to personalize your message.
          </AlertDescription>
        </Alert>

        {/* Success Alert */}
        {lastSentEmail && (
          <Alert className="bg-green-50 text-green-800 border-green-200">
            <CheckCircle className="h-4 w-4" />
            <AlertTitle>Last Email Sent Successfully</AlertTitle>
            <AlertDescription>
              Promo code was successfully sent to <strong>{lastSentEmail}</strong>
            </AlertDescription>
          </Alert>
        )}

        {/* Template Type Selection */}
        <div className="space-y-2">
          <Label htmlFor="templateType" className="text-sm font-medium text-gray-700">
            Email Template Type *
          </Label>
          <Select value={formData.templateType} onValueChange={handleTemplateChange}>
            <SelectTrigger className="w-full rounded-lg border-gray-200 focus:border-pink-300 focus:ring-pink-200">
              <SelectValue placeholder="Choose email template type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-green-600" />
                  <span>General Promo</span>
                </div>
              </SelectItem>
              <SelectItem value="loyalty">
                <div className="flex items-center gap-2">
                  <Crown className="h-4 w-4 text-yellow-600" />
                  <span>Loyalty Customer</span>
                </div>
              </SelectItem>
              <SelectItem value="comeback">
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-purple-600" />
                  <span>Welcome Back</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
          
          {/* Template Info */}
          <div className={`p-3 rounded-lg border ${currentTemplateInfo.bgColor}`}>
            <div className="flex items-center gap-2 mb-1">
              {currentTemplateInfo.icon}
              <span className={`font-medium text-sm ${currentTemplateInfo.textColor}`}>
                {currentTemplateInfo.title}
              </span>
            </div>
            <p className={`text-xs ${currentTemplateInfo.textColor}`}>
              {currentTemplateInfo.description}
            </p>
          </div>
        </div>

        {/* Email Input */}
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-gray-700">
            Recipient Email Address *
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="user@example.com"
            value={formData.email}
            onChange={handleInputChange}
            className="w-full rounded-lg border-gray-200 focus:border-pink-300 focus:ring-pink-200"
            disabled={isSubmitting || isTesting}
          />
        </div>

        {/* Promo Code Input */}
        <div className="space-y-2">
          <Label htmlFor="promoCode" className="text-sm font-medium text-gray-700">
            Promo Code *
          </Label>
          <Input
            id="promoCode"
            name="promoCode"
            type="text"
            placeholder="SAVE20"
            value={formData.promoCode}
            onChange={handleInputChange}
            className="w-full rounded-lg border-gray-200 focus:border-pink-300 focus:ring-pink-200 font-mono"
            disabled={isSubmitting || isTesting}
          />
          <p className="text-xs text-gray-500">
            Enter the promo code exactly as users should enter it (3-50 characters)
          </p>
        </div>

        {/* Admin Message */}
        <div className="space-y-2">
          <Label htmlFor="adminMessage" className="text-sm font-medium text-gray-700">
            Personal Message (Optional)
          </Label>
          <Textarea
            id="adminMessage"
            name="adminMessage"
            placeholder={
              formData.templateType === 'loyalty' 
                ? "Add a personal note to thank this loyal customer..."
                : formData.templateType === 'comeback'
                ? "Add a personal welcome back message..."
                : "Add a personal message to accompany the promo code..."
            }
            value={formData.adminMessage}
            onChange={handleInputChange}
            rows={3}
            className="w-full rounded-lg border-gray-200 focus:border-pink-300 focus:ring-pink-200 resize-none"
            disabled={isSubmitting || isTesting}
          />
          <p className="text-xs text-gray-500">
            This message will appear in the email along with the template-specific content
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <Button
            onClick={handleSendPromo}
            disabled={isSubmitting || isTesting || !formData.email.trim() || !formData.promoCode.trim()}
            className="flex-1 bg-gradient-to-r from-pink-500 to-red-600 hover:from-pink-600 hover:to-red-700 text-white font-semibold py-2.5 px-6 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Send {currentTemplateInfo.title} Email
              </>
            )}
          </Button>
          
          <Button
            onClick={handleTestEmail}
            variant="outline"
            disabled={isSubmitting || isTesting}
            className="border-gray-300 text-gray-700 hover:bg-gray-50 font-medium py-2.5 px-6 rounded-lg transition-all duration-200"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <TestTube className="h-4 w-4 mr-2" />
                Send Test
              </>
            )}
          </Button>
        </div>

        {/* Help Text */}
        <div className="pt-2 border-t border-gray-100">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-gray-600">
              <p className="font-medium mb-1">Template Information:</p>
              <ul className="space-y-1 list-disc list-inside ml-2">
                <li><strong>Loyalty Customer:</strong> Thanks customers for continued support with golden styling</li>
                <li><strong>Welcome Back:</strong> Re-engages inactive customers with purple styling</li>
                <li><strong>General Promo:</strong> Standard promotional email with green styling</li>
                <li>Each template has unique messaging and visual design</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 