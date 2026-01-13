import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  HelpCircle, 
  BookOpen, 
  FileText, 
  Settings, 
  Building2, 
  Package, 
  Wrench,
  CheckCircle,
  X,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Info,
  AlertCircle,
  Upload
} from "lucide-react";

interface HelpCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ManagerHelpCenter({ isOpen, onClose }: HelpCenterProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const helpSections = [
    {
      id: "setup",
      title: "Onboarding Wizard",
      icon: <Sparkles className="h-5 w-5" />,
      description: "Complete step-by-step guide to setting up your kitchen",
      content: (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            The onboarding wizard will walk you through everything you need to get your kitchen ready for bookings, including location setup, kitchen license upload, and creating your first kitchen.
          </p>
          <Button 
            onClick={() => {
              // Trigger onboarding wizard to open
              const event = new CustomEvent('open-onboarding-from-help');
              window.dispatchEvent(event);
            }} 
            className="w-full"
          >
            <BookOpen className="h-4 w-4 mr-2" />
            Open Onboarding Wizard
          </Button>
        </div>
      )
    },
    {
      id: "locations",
      title: "Managing Locations",
      icon: <Building2 className="h-5 w-5" />,
      description: "How to add and manage your kitchen locations",
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">What is a Location?</h4>
            <p className="mb-3">
              A location is your business address where your kitchen is located. This is what chefs will see when searching for kitchen spaces.
            </p>
            <h4 className="font-semibold mb-2">Adding a Location</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Go to Settings in your dashboard</li>
              <li>Click "Add Location" or edit an existing location</li>
              <li>Enter your location name and full address</li>
              <li>Configure notification preferences</li>
              <li>Save your changes</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "kitchens",
      title: "Creating Kitchens",
      icon: <Settings className="h-5 w-5" />,
      description: "Understanding kitchens and how to create them",
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">What is a Kitchen?</h4>
            <p className="mb-3">
              A kitchen is a specific space within your location where chefs can book time. If you have multiple kitchen spaces at one location, create separate kitchens for each.
            </p>
            <h4 className="font-semibold mb-2">Creating a Kitchen</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Navigate to your location settings</li>
              <li>Click "Add Kitchen"</li>
              <li>Enter a descriptive name (e.g., "Main Kitchen", "Prep Kitchen")</li>
              <li>Add an optional description</li>
              <li>Save to create the kitchen</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "license",
      title: "Kitchen License",
      icon: <FileText className="h-5 w-5" />,
      description: "Uploading and managing your kitchen license",
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">Why is a License Required?</h4>
            <p className="mb-3">
              Your kitchen license must be approved by an admin before bookings can be activated. This ensures all kitchens on the platform meet safety and regulatory requirements.
            </p>
            <h4 className="font-semibold mb-2">Uploading Your License</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Go to Settings → Location Settings</li>
              <li>Find the "Kitchen License" section</li>
              <li>Click "Upload License"</li>
              <li>Select your license file (PDF, JPG, or PNG, max 10MB)</li>
              <li>Submit for admin review</li>
            </ol>
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800">
                <strong>Note:</strong> Bookings will remain disabled until your license is approved. You'll receive an email notification when your license is reviewed.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "storage",
      title: "Storage Listings",
      icon: <Package className="h-5 w-5" />,
      description: "Adding storage options for chefs to book",
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">What are Storage Listings?</h4>
            <p className="mb-3">
              Storage listings allow chefs to book dry storage, cold storage, or freezer space at your kitchen. You can add multiple storage options with different sizes and prices.
            </p>
            <h4 className="font-semibold mb-2">Adding Storage Listings</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Navigate to Storage Listings in your dashboard</li>
              <li>Select the kitchen where storage is available</li>
              <li>Click "Add Storage Listing"</li>
              <li>Choose storage type (dry, cold, or freezer)</li>
              <li>Enter name, description, and pricing</li>
              <li>Upload photos (optional but recommended)</li>
              <li>Save your listing</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "equipment",
      title: "Equipment Listings",
      icon: <Wrench className="h-5 w-5" />,
      description: "Adding equipment that chefs can use or rent",
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">What are Equipment Listings?</h4>
            <p className="mb-3">
              Equipment listings let chefs know what equipment is available. You can offer equipment as included with bookings or as paid add-ons (rentals).
            </p>
            <h4 className="font-semibold mb-2">Adding Equipment Listings</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>Navigate to Equipment Listings in your dashboard</li>
              <li>Select the kitchen where equipment is available</li>
              <li>Click "Add Equipment Listing"</li>
              <li>Choose category (cooking, prep, refrigeration, baking, other)</li>
              <li>Select availability type (included or rental)</li>
              <li>Enter name, description, condition, and pricing (if rental)</li>
              <li>Upload photos (optional but recommended)</li>
              <li>Save your listing</li>
            </ol>
          </div>
        </div>
      )
    }
  ];

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl flex items-center gap-2">
              <HelpCircle className="h-6 w-6" />
              Help Center
            </DialogTitle>
            <DialogDescription>
              Find answers and guides for managing your kitchen
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {helpSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(activeSection === section.id ? null : section.id)}
                className={`text-left p-4 rounded-lg border-2 transition-all ${
                  activeSection === section.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${
                    activeSection === section.id ? "bg-blue-100" : "bg-gray-100"
                  }`}>
                    {section.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">{section.title}</h3>
                    <p className="text-xs text-gray-600">{section.description}</p>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${
                    activeSection === section.id ? "rotate-90" : ""
                  }`} />
                </div>
              </button>
            ))}
          </div>

          {activeSection && (
            <div className="mt-6 p-6 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  {helpSections.find(s => s.id === activeSection)?.title}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSection(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {helpSections.find(s => s.id === activeSection)?.content}
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Need more help? Contact support for assistance.
              </p>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
