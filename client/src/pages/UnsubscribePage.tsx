import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, CheckCircle, Mail } from 'lucide-react';
import React, { useState } from 'react';
import { useLocation } from 'wouter';

const UnsubscribePage: React.FC = () => {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUnsubscribed, setIsUnsubscribed] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    reason: '',
    feedback: ''
  });

  // Get email from URL params if provided
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const emailParam = urlParams.get('email');
    if (emailParam) {
      setFormData(prev => ({ ...prev, email: emailParam }));
    }
  }, []);

  const handleUnsubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.email) {
      toast({
        title: "Email Required",
        description: "Please enter your email address to unsubscribe.",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          reason: formData.reason,
          feedback: formData.feedback,
          timestamp: new Date().toISOString()
        }),
      });

      if (response.ok) {
        setIsUnsubscribed(true);
        toast({
          title: "✅ Unsubscribe Request Sent",
          description: "We've received your unsubscribe request and will process it within 24 hours.",
        });
      } else {
        throw new Error('Failed to submit unsubscribe request');
      }
    } catch (error) {
      toast({
        title: "Request Failed",
        description: "There was an error processing your request. Please try again or contact us directly.",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  if (isUnsubscribed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md mx-auto shadow-xl">
          <CardHeader className="text-center bg-gradient-to-r from-red-500 to-red-600 text-white rounded-t-lg">
            <div className="flex justify-center mb-4">
              <CheckCircle className="h-16 w-16" />
            </div>
            <CardTitle className="text-2xl font-bold">Request Received</CardTitle>
            <CardDescription className="text-red-100">
              Thank you for your feedback
            </CardDescription>
          </CardHeader>
          <CardContent className="p-8 text-center">
            <p className="text-gray-700 mb-6">
              We've received your unsubscribe request and will process it within 24 hours. 
              You may receive one final confirmation email.
            </p>
            <p className="text-sm text-gray-600 mb-6">
              If you have any questions, please contact us at{' '}
              <a href="mailto:localcooks@localcook.shop" className="text-red-600 hover:text-red-700 font-medium">
                localcooks@localcook.shop
              </a>
            </p>
            <Button 
              onClick={() => setLocation('/')}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Return to Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-orange-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md mx-auto shadow-xl">
        <CardHeader className="text-center bg-gradient-to-r from-red-500 to-red-600 text-white rounded-t-lg">
          <div className="flex justify-center mb-4">
            <img 
              src="https://raw.githubusercontent.com/Raunak-Sarmacharya/LocalCooksCommunity/refs/heads/main/attached_assets/emailHeader.png" 
              alt="Local Cooks" 
              className="h-18 w-auto"
            />
          </div>
          <CardDescription className="text-red-100">
            Unsubscribe from our emails
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8">
          <form onSubmit={handleUnsubscribe} className="space-y-4">
            <div>
              <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                Email Address *
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="Enter your email address"
                required
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="reason" className="text-sm font-medium text-gray-700">
                Reason for unsubscribing (optional)
              </Label>
              <select
                id="reason"
                value={formData.reason}
                onChange={(e) => handleInputChange('reason', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
              >
                <option value="">Select a reason</option>
                <option value="too-many-emails">Too many emails</option>
                <option value="not-relevant">Content not relevant</option>
                <option value="never-signed-up">Never signed up</option>
                <option value="privacy-concerns">Privacy concerns</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <Label htmlFor="feedback" className="text-sm font-medium text-gray-700">
                Additional feedback (optional)
              </Label>
              <Textarea
                id="feedback"
                value={formData.feedback}
                onChange={(e) => handleInputChange('feedback', e.target.value)}
                placeholder="Help us improve by sharing your thoughts..."
                rows={3}
                className="mt-1"
              />
            </div>

            <div className="flex space-x-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation('/')}
                className="flex-1 border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Unsubscribe
                  </>
                )}
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-200 text-center">
            <p className="text-xs text-gray-500">
              Questions? Contact us at{' '}
              <a href="mailto:localcooks@localcook.shop" className="text-red-600 hover:text-red-700">
                localcooks@localcook.shop
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default UnsubscribePage;