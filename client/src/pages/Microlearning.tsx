import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, Award, BookOpen, ShieldCheck } from 'lucide-react';
import MicrolearningModule from '@/components/microlearning/MicrolearningModule';

export default function Microlearning() {
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    // Generate or retrieve a temporary user ID for progress tracking
    let tempUserId = localStorage.getItem('microlearning_user_id');
    if (!tempUserId) {
      // Generate a random user ID for anonymous users
      tempUserId = String(Math.floor(Math.random() * 1000000) + 1000000);
      localStorage.setItem('microlearning_user_id', tempUserId);
    }
    setUserId(parseInt(tempUserId));
  }, []);

  if (!userId) {
    return <div className="flex justify-center items-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <ShieldCheck className="h-16 w-16 text-green-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Government of Canada Food Safety Training
          </h1>
          <p className="text-xl text-gray-600 mb-6 max-w-3xl mx-auto">
            Free, comprehensive food safety microlearning featuring official content from Health Canada 
            and the Canadian Food Inspection Agency (CFIA). No registration required.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              🍁 Official Government Content
            </Badge>
            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
              🆓 Free Access
            </Badge>
            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
              📜 Certificate Available
            </Badge>
            <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
              ⏱️ ~20 Minutes Total
            </Badge>
          </div>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader className="text-center">
              <BookOpen className="h-12 w-12 text-blue-600 mx-auto mb-2" />
              <CardTitle className="text-lg">Self-Paced Learning</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-center">
                Learn at your own pace with interactive video modules. Progress is saved automatically.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Users className="h-12 w-12 text-green-600 mx-auto mb-2" />
              <CardTitle className="text-lg">For Everyone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-center">
                Accessible to all food handlers, whether you're new to food service or seeking to refresh your knowledge.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="text-center">
              <Award className="h-12 w-12 text-purple-600 mx-auto mb-2" />
              <CardTitle className="text-lg">Official Certification</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-center">
                Receive a certificate of completion aligned with Safe Food for Canadians Regulations.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Training Module */}
        <MicrolearningModule userId={userId} />

        {/* Footer Information */}
        <div className="mt-12 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-800 mb-3">About This Training</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-700">
            <div>
              <h4 className="font-medium mb-2">Official Sources</h4>
              <ul className="space-y-1">
                <li>• Health Canada Food Safety Guidelines</li>
                <li>• Canadian Food Inspection Agency (CFIA)</li>
                <li>• Safe Food for Canadians Regulations</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Learning Outcomes</h4>
              <ul className="space-y-1">
                <li>• Understand safe food handling practices</li>
                <li>• Prevent cross-contamination</li>
                <li>• Manage food allergens safely</li>
                <li>• Meet regulatory compliance standards</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 