import React, { useState } from "react";
import { CheckCircle, Loader2, Plus, Settings, Edit2, ChevronDown, ChevronUp, Image, DollarSign, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { KitchenGalleryImages } from "@/components/manager/kitchen/KitchenGalleryImages";
import { useManagerOnboarding } from "../ManagerOnboardingContext";
import { OnboardingNavigationFooter } from "../OnboardingNavigationFooter";

interface KitchenCardProps {
  kitchen: any;
  locationId: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function KitchenCard({ kitchen, locationId, isExpanded, onToggle }: KitchenCardProps) {
  const hasImage = !!kitchen.imageUrl || (kitchen.galleryImages && kitchen.galleryImages.length > 0);
  const hourlyRateDisplay = kitchen.hourlyRate
    ? `$${(parseFloat(kitchen.hourlyRate) / 100).toFixed(2)}/hr`
    : 'Not set';

  return (
    <Card className="overflow-hidden">
      <Collapsible open={isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Kitchen Thumbnail */}
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {kitchen.imageUrl || (kitchen.galleryImages && kitchen.galleryImages.length > 0) ? (
                    <img
                      src={kitchen.imageUrl || kitchen.galleryImages[0]}
                      alt={kitchen.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Settings className="w-6 h-6 text-muted-foreground" />
                  )}
                </div>

                <div>
                  <CardTitle className="text-base">{kitchen.name}</CardTitle>
                  <CardDescription className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1">
                      <DollarSign className="w-3 h-3" />
                      {hourlyRateDisplay}
                    </span>
                    {kitchen.minimumBookingHours && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Min {kitchen.minimumBookingHours}h
                      </span>
                    )}
                    {!hasImage && (
                      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">
                        <Image className="w-3 h-3 mr-1" />
                        No photos
                      </Badge>
                    )}
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            <Separator />

            {/* Description */}
            <div>
              <h4 className="text-sm font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">
                {kitchen.description || "No description provided. You can add one from the Kitchen Settings page."}
              </p>
            </div>

            {/* Gallery Images */}
            <div>
              <h4 className="text-sm font-medium mb-3">Gallery Images</h4>
              <KitchenGalleryImages
                kitchenId={kitchen.id}
                galleryImages={kitchen.galleryImages || []}
                locationId={locationId}
              />
            </div>

            {/* Quick Actions */}
            <div className="flex justify-end pt-2">
              <Button variant="outline" size="sm" asChild>
                <a href={`/manager/dashboard?location=${locationId}&kitchen=${kitchen.id}&tab=settings`}>
                  <Edit2 className="w-4 h-4 mr-2" />
                  Edit Kitchen Details
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
    selectedLocationId
  } = useManagerOnboarding();

  const { data, setData, showCreate, setShowCreate, isCreating } = kitchenForm;
  const [expandedKitchenId, setExpandedKitchenId] = useState<number | null>(null);

  const handleToggleExpand = (kitchenId: number) => {
    setExpandedKitchenId(prev => prev === kitchenId ? null : kitchenId);
  };


  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Kitchen Spaces</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your kitchen spaces for this location. Add photos and details to attract chefs.
        </p>
      </div>

      {/* Existing Kitchens */}
      {kitchens.length > 0 && (
        <div className="space-y-4">
          <Alert className="border-green-200 bg-green-50 text-green-800 [&>svg]:text-green-600">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              <span className="font-medium">
                {kitchens.length} kitchen{kitchens.length > 1 ? 's' : ''} configured
              </span>
              {' '}— Click a kitchen below to add photos or view details.
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
            <Button variant="outline" onClick={() => setShowCreate(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" /> Add Another Kitchen
            </Button>
          )}
        </div>
      )}

      {/* Empty State */}
      {kitchens.length === 0 && !showCreate && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Settings className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No kitchen created yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Create your first kitchen space to start accepting bookings from chefs. You can add more kitchens later.
            </p>
            <Button onClick={() => setShowCreate(true)} size="lg">
              <Plus className="h-4 w-4 mr-2" /> Create Your First Kitchen
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create Kitchen Form */}
      {showCreate && (
        <Card className="animate-in fade-in zoom-in-95 duration-200 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg">New Kitchen Space</CardTitle>
            <CardDescription>Enter the basic details for your new kitchen. You can add photos and more details after creation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="kitchen-name">Kitchen Name <span className="text-destructive">*</span></Label>
                <Input
                  id="kitchen-name"
                  value={data.name}
                  onChange={(e) => setData({ ...data, name: e.target.value })}
                  placeholder="e.g., Main Kitchen, Prep Area, Bakery Station"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="kitchen-description">Description <span className="text-muted-foreground font-normal ml-1">(Optional)</span></Label>
                <Textarea
                  id="kitchen-description"
                  value={data.description}
                  onChange={(e) => setData({ ...data, description: e.target.value })}
                  placeholder="Describe your kitchen space, equipment, and what makes it special..."
                  rows={3}
                />
              </div>
            </div>

            <Separator />

            <div>
              <h5 className="text-sm font-semibold text-foreground mb-3">Pricing</h5>
              <div className="grid grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label>Hourly Rate <span className="text-destructive">*</span></Label>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={data.hourlyRate}
                      onChange={(e) => setData({ ...data, hourlyRate: e.target.value })}
                      placeholder="25.00"
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Currency</Label>
                  <Select
                    value={data.currency}
                    onValueChange={(val) => setData({ ...data, currency: val })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CAD">CAD ($)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Min. Hours</Label>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={data.minimumBookingHours}
                    onChange={(e) => setData({ ...data, minimumBookingHours: e.target.value })}
                    placeholder="1"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={() => createKitchen()}
                disabled={isCreating || !data.name || !data.hourlyRate}
                className="flex-1"
              >
                {isCreating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                {isCreating ? "Creating..." : "Create Kitchen"}
              </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)} disabled={isCreating}>
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
          showBack={!isFirstStep}
          isNextDisabled={kitchens.length === 0}
        />
      )}
    </div>
  );
}
