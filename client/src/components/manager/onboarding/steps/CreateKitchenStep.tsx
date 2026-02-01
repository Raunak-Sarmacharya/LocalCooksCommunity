import React, { useState } from "react";
import { CheckCircle, Loader2, Plus, ChefHat, Edit2, ChevronDown, ChevronUp, Image, DollarSign, Clock, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { KitchenGalleryImages } from "@/components/manager/kitchen/KitchenGalleryImages";
import { ImageWithReplace } from "@/components/ui/image-with-replace";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";
import { cn } from "@/lib/utils";
import { getR2ProxyUrl } from "@/utils/r2-url-helper";

// Enterprise-grade Kitchen Card Component
interface KitchenCardProps {
  kitchen: any;
  locationId: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function KitchenCard({ kitchen, locationId, isExpanded, onToggle }: KitchenCardProps) {
  const rawImageUrl = kitchen.imageUrl || (kitchen.galleryImages && kitchen.galleryImages.length > 0 ? kitchen.galleryImages[0] : null);
  const imageUrl = rawImageUrl ? getR2ProxyUrl(rawImageUrl) : null;
  const hasImage = !!rawImageUrl;
  const hourlyRateDisplay = kitchen.hourlyRate
    ? `$${(parseFloat(kitchen.hourlyRate) / 100).toFixed(2)}/hr`
    : 'Not set';

  return (
    <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm overflow-hidden transition-all hover:shadow-md">
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Kitchen Thumbnail */}
                <div className="w-14 h-14 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden shrink-0 border border-slate-200 dark:border-slate-700">
                  {imageUrl ? (
                    <img
                      src={imageUrl}
                      alt={kitchen.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                  ) : (
                    <ChefHat className="w-6 h-6 text-slate-400" />
                  )}
                </div>

                <div>
                  <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">{kitchen.name}</CardTitle>
                  <div className="flex items-center gap-3 mt-1.5">
                    <Badge variant="secondary" className="text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      <DollarSign className="w-3 h-3 mr-0.5" />
                      {hourlyRateDisplay}
                    </Badge>
                    {kitchen.minimumBookingHours && (
                      <Badge variant="secondary" className="text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                        <Clock className="w-3 h-3 mr-0.5" />
                        Min {kitchen.minimumBookingHours}h
                      </Badge>
                    )}
                    {!hasImage && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
                        <Image className="w-3 h-3 mr-1" />
                        Add photos
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                  isExpanded ? "bg-slate-100 dark:bg-slate-800" : "bg-transparent"
                )}>
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-500" />
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-5 border-t border-slate-100 dark:border-slate-800">
            {/* Description */}
            <div className="pt-4">
              <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">Description</Label>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-1.5">
                {kitchen.description || "No description provided yet."}
              </p>
            </div>

            {/* Gallery Images */}
            <div>
              <Label className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-3 block">Gallery Images</Label>
              <KitchenGalleryImages
                kitchenId={kitchen.id}
                galleryImages={kitchen.galleryImages || []}
                locationId={locationId}
              />
            </div>

            {/* Quick Actions */}
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" className="text-slate-600 dark:text-slate-400" asChild>
                <a href={`/manager/dashboard?location=${locationId}&kitchen=${kitchen.id}&tab=settings`}>
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                  Edit Details
                </a>
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}


export default function CreateKitchenStep() {
  const {
    kitchens,
    kitchenForm,
    createKitchen,
    handleNext,
    handleBack,
    isFirstStep,
    selectedLocationId,
    skipCurrentStep
  } = useManagerOnboarding();

  const { data, setData, showCreate, setShowCreate, isCreating } = kitchenForm;
  const [expandedKitchenId, setExpandedKitchenId] = useState<number | null>(null);

  const handleToggleExpand = (kitchenId: number) => {
    setExpandedKitchenId(prev => prev === kitchenId ? null : kitchenId);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Existing Kitchens - Success State */}
      {kitchens.length > 0 && (
        <div className="space-y-4">
          <Alert className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900/50">
            <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <AlertDescription className="text-sm text-emerald-700 dark:text-emerald-300">
              <span className="font-medium">
                {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} configured
              </span>
              {' '}— Expand to add photos or edit details.
            </AlertDescription>
          </Alert>

          {/* Kitchen Cards */}
          <div className="space-y-3">
            {kitchens.map((kitchen: any) => (
              <KitchenCard
                key={kitchen.id}
                kitchen={kitchen}
                locationId={selectedLocationId!}
                isExpanded={expandedKitchenId === kitchen.id}
                onToggle={() => handleToggleExpand(kitchen.id)}
              />
            ))}
          </div>

          {/* Add Another Kitchen Button */}
          {!showCreate && (
            <Button 
              variant="outline" 
              onClick={() => setShowCreate(true)} 
              className="w-full border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 text-slate-600 dark:text-slate-400"
            >
              <Plus className="h-4 w-4 mr-2" /> Add Another Kitchen Space
            </Button>
          )}
        </div>
      )}

      {/* Empty State - Enterprise Design */}
      {kitchens.length === 0 && !showCreate && (
        <Card className="border-dashed border-2 border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50">
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-950/30 flex items-center justify-center mx-auto mb-5">
              <ChefHat className="h-8 w-8 text-[#F51042]" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Create Your Kitchen Space</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
              Set up your first kitchen to start receiving booking requests from chefs in your area.
            </p>
            <Button onClick={() => setShowCreate(true)} size="lg" className="bg-[#F51042] hover:bg-[#d90e39]">
              <Plus className="h-4 w-4 mr-2" /> Create Kitchen Space
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Kitchen Form - Enterprise Design */}
      {showCreate && (
        <Card className="border-slate-200/60 dark:border-slate-700/60 shadow-sm animate-in fade-in zoom-in-95 duration-200">
          <CardContent className="space-y-6 pt-6">
            {/* Basic Information Section */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="kitchen-name" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Kitchen Name
                  <span className="text-destructive ml-1">*</span>
                </Label>
                <Input
                  id="kitchen-name"
                  value={data.name}
                  onChange={(e) => setData({ ...data, name: e.target.value })}
                  placeholder="e.g., Main Kitchen, Prep Area, Bakery Station"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="kitchen-description" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Description
                  </Label>
                  <span className="text-xs text-slate-400">(Optional)</span>
                </div>
                <Textarea
                  id="kitchen-description"
                  value={data.description}
                  onChange={(e) => setData({ ...data, description: e.target.value })}
                  placeholder="Describe your kitchen space, equipment, and what makes it special for chefs..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              {/* Cover Image */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Cover Image
                  </Label>
                  <span className="text-xs text-slate-400">(Optional)</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="w-3.5 h-3.5 text-slate-400 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p className="text-xs">A great cover photo helps attract more chefs to your space.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <div className="max-w-md">
                  <ImageWithReplace
                    imageUrl={data.imageUrl || undefined}
                    onImageChange={(url) => setData({ ...data, imageUrl: url || '' })}
                    onRemove={() => setData({ ...data, imageUrl: '' })}
                    className="h-40 object-cover rounded-lg"
                    aspectRatio="16/9"
                    fieldName="kitchen-cover"
                  />
                </div>
              </div>
            </div>

            {/* Pricing Section */}
            <Card className="border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30">
              <CardContent className="py-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Hourly Rate (CAD)
                      <span className="text-destructive ml-1">*</span>
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={data.hourlyRate}
                        onChange={(e) => setData({ ...data, hourlyRate: e.target.value })}
                        placeholder="25.00"
                        className="pl-7 h-10"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Minimum Booking
                      <span className="text-xs text-slate-400 font-normal ml-1">(hours)</span>
                    </Label>
                    <Input
                      type="number"
                      min="0.25"
                      step="0.25"
                      value={data.minimumBookingHours}
                      onChange={(e) => setData({ ...data, minimumBookingHours: e.target.value })}
                      placeholder="1"
                      className="h-10"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => createKitchen()}
                disabled={isCreating || !data.name || !data.hourlyRate}
                className="flex-1 bg-[#F51042] hover:bg-[#d90e39]"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Create Kitchen
                  </>
                )}
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setShowCreate(false)} 
                disabled={isCreating}
                className="text-slate-600 dark:text-slate-400"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navigation Footer */}
      {!showCreate && (
        <OnboardingNavigationFooter
          onNext={handleNext}
          onBack={handleBack}
          onSkip={skipCurrentStep}
          showBack={!isFirstStep}
          showSkip={true}
          isNextDisabled={kitchens.length === 0}
        />
      )}
    </div>
  );
}
