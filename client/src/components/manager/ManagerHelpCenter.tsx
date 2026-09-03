import { useState } from "react";
import { mt } from "@/i18n/manager";
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
  ClipboardList,
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
      title: mt("helpOnboardingWizardTitle"),
      icon: <ClipboardList className="h-5 w-5" />,
      description: mt("helpOnboardingWizardDesc"),
      content: (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            {mt("helpOnboardingWizardIntro")}
          </p>
          <Button
            onClick={() => {
              // Trigger onboarding wizard to open
              onClose(); // Close the help dialog first
              // We use window.location for now as wouter hook might trigger re-render issues inside this dialog content
              // if not carefully handled. Or we pass navigate function.
              // Ideally use useLocation from wouter if this component is inside Router
              window.location.href = '/manager/setup';
            }}
            className="w-full"
          >
            <BookOpen className="h-4 w-4 mr-2" />{mt("openOnboardingWizard")}</Button>
        </div>
      )
    },
    {
      id: "locations",
      title: mt("helpManagingLocationsTitle"),
      icon: <Building2 className="h-5 w-5" />,
      description: mt("helpManagingLocationsDesc"),
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">{mt("whatIsALocation")}</h4>
            <p className="mb-3">
              {mt("helpLocationWhatIsDesc")}
            </p>
            <h4 className="font-semibold mb-2">{mt("addingALocation")}</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>{mt("goToSettingsInYourDashboard")}</li>
              <li>{mt("clickAddLocationOrEdit")}</li>
              <li>{mt("enterYourLocationNameAndFullAddress")}</li>
              <li>{mt("configureNotificationPreferences")}</li>
              <li>{mt("saveYourChanges")}</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "kitchens",
      title: mt("helpCreatingKitchensTitle"),
      icon: <Settings className="h-5 w-5" />,
      description: mt("helpCreatingKitchensDesc"),
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">{mt("whatIsAKitchen")}</h4>
            <p className="mb-3">
              {mt("helpKitchenWhatIsDesc")}
            </p>
            <h4 className="font-semibold mb-2">{mt("creatingAKitchen")}</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>{mt("navigateToYourLocationSettings")}</li>
              <li>{mt("clickAddKitchen")}</li>
              <li>{mt("enterDescriptiveKitchenName")}</li>
              <li>{mt("addAnOptionalDescription")}</li>
              <li>{mt("saveToCreateTheKitchen")}</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "license",
      title: mt("helpKitchenLicenseTitle"),
      icon: <FileText className="h-5 w-5" />,
      description: mt("helpKitchenLicenseDesc"),
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">{mt("whyIsALicenseRequired")}</h4>
            <p className="mb-3">
              {mt("licenseRequiredDescription")}
            </p>
            <h4 className="font-semibold mb-2">{mt("uploadingYourLicense")}</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>{mt("goToSettingsLocationSettings")}</li>
              <li>{mt("findKitchenLicenseSection")}</li>
              <li>{mt("clickUploadLicense")}</li>
              <li>{mt("selectYourLicenseFilePDFJPGOrPNGMax10MB")}</li>
              <li>{mt("submitForAdminReview")}</li>
            </ol>
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800">
                <strong>{mt("note")}</strong> {mt("licenseApprovalNote")}
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "storage",
      title: mt("helpStorageListingsTitle"),
      icon: <Package className="h-5 w-5" />,
      description: mt("helpStorageListingsDesc"),
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">{mt("whatAreStorageListings")}</h4>
            <p className="mb-3">
              {mt("helpStorageWhatIsDesc")}
            </p>
            <h4 className="font-semibold mb-2">{mt("addingStorageListings")}</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>{mt("navigateToStorageListingsInYourDashboard")}</li>
              <li>{mt("selectTheKitchenWhereStorageIsAvailable")}</li>
              <li>{mt("clickAddStorageListing")}</li>
              <li>{mt("chooseStorageTypeDryColdOrFreezer")}</li>
              <li>{mt("enterNameDescriptionAndPricing")}</li>
              <li>{mt("uploadPhotosOptionalButRecommended")}</li>
              <li>{mt("saveYourListing")}</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: "equipment",
      title: mt("helpEquipmentListingsTitle"),
      icon: <Wrench className="h-5 w-5" />,
      description: mt("helpEquipmentListingsDesc"),
      content: (
        <div className="space-y-4 text-sm text-gray-700">
          <div>
            <h4 className="font-semibold mb-2">{mt("whatAreEquipmentListings")}</h4>
            <p className="mb-3">
              {mt("helpEquipmentWhatIsDesc")}
            </p>
            <h4 className="font-semibold mb-2">{mt("addingEquipmentListings")}</h4>
            <ol className="list-decimal list-inside space-y-2 ml-2">
              <li>{mt("navigateToEquipmentListingsInYourDashboard")}</li>
              <li>{mt("selectTheKitchenWhereEquipmentIsAvailable")}</li>
              <li>{mt("clickAddEquipmentListing")}</li>
              <li>{mt("chooseCategoryCookingPrepRefrigerationBakingOther")}</li>
              <li>{mt("selectAvailabilityTypeIncludedOrRental")}</li>
              <li>{mt("enterNameDescriptionConditionAndPricingIfRental")}</li>
              <li>{mt("uploadPhotosOptionalButRecommended")}</li>
              <li>{mt("saveYourListing")}</li>
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
              <HelpCircle className="h-6 w-6" />{mt("helpCenter")}</DialogTitle>
            <DialogDescription>{mt("findAnswersAndGuidesForManagingYourKitchen")}</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            {helpSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(activeSection === section.id ? null : section.id)}
                className={`text-left p-4 rounded-lg border-2 transition-all ${activeSection === section.id
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                  }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${activeSection === section.id ? "bg-blue-100" : "bg-gray-100"
                    }`}>
                    {section.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">{section.title}</h3>
                    <p className="text-xs text-gray-600">{section.description}</p>
                  </div>
                  <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform ${activeSection === section.id ? "rotate-90" : ""
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
              <p className="text-sm text-gray-600">{mt("needMoreHelpContactSupportForAssistance")}</p>
              <Button variant="outline" onClick={onClose}>{mt("close")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
