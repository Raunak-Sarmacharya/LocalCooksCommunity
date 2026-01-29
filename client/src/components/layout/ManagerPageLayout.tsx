import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useManagerDashboard } from "@/hooks/use-manager-dashboard";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Menu, Building2, UtensilsCrossed } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

interface ManagerPageLayoutProps {
  children: (props: {
    selectedLocationId: number | null;
    selectedKitchenId: number | null;
    isLoading: boolean;
  }) => React.ReactNode;
  title?: string;
  description?: string;
  showKitchenSelector?: boolean;
}

export function ManagerPageLayout({
  children,
  title,
  description,
  showKitchenSelector = true,
}: ManagerPageLayoutProps) {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);

  const { locations, isLoadingLocations, kitchens, isLoadingKitchens } = useManagerDashboard();

  // URL State Management
  const urlLocationId = searchParams.get("loc") ? parseInt(searchParams.get("loc")!) : null;
  const urlKitchenId = searchParams.get("kit") ? parseInt(searchParams.get("kit")!) : null;

  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [selectedKitchenId, setSelectedKitchenId] = useState<number | null>(urlKitchenId);

  // Sync state with URL
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    let updated = false;

    if (selectedLocationId && selectedLocationId !== urlLocationId) {
      params.set("loc", selectedLocationId.toString());
      updated = true;
    } else if (!selectedLocationId && params.has("loc")) {
      params.delete("loc");
      updated = true;
    }

    if (selectedKitchenId && selectedKitchenId !== urlKitchenId) {
      params.set("kit", selectedKitchenId.toString());
      updated = true;
    } else if (!selectedKitchenId && params.has("kit")) {
      params.delete("kit");
      updated = true;
    }

    if (updated) {
      const newSearch = params.toString();
      const newUrl = location + (newSearch ? `?${newSearch}` : "");
      window.history.replaceState(null, "", newUrl);
    }
  }, [selectedLocationId, selectedKitchenId, location, searchString, urlLocationId, urlKitchenId]);


  // Sync state with URL only on init or when URL changes
  useEffect(() => {
    if (urlLocationId !== selectedLocationId) setSelectedLocationId(urlLocationId);
  }, [urlLocationId]);

  useEffect(() => {
    if (urlKitchenId !== selectedKitchenId) setSelectedKitchenId(urlKitchenId);
  }, [urlKitchenId]);


  // Auto-select single location
  useEffect(() => {
    if (!isLoadingLocations && locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
  }, [isLoadingLocations, locations, selectedLocationId]);

  // Derived state
  const availableKitchens = kitchens.filter(k => k.locationId === selectedLocationId);

  // Filtering Logic Handlers
  const handleLocationChange = (val: string) => {
    const id = parseInt(val);
    setSelectedLocationId(id);
    setSelectedKitchenId(null);
  };

  const handleKitchenChange = (val: string) => {
    setSelectedKitchenId(parseInt(val));
  };

  return (
    <div className="flex flex-col flex-1 h-full min-h-[500px] overflow-hidden bg-background rounded-xl border shadow-sm">
      {/* Mobile Header with Sidebar Trigger */}
      <div className="md:hidden flex items-center justify-between p-4 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-2">
          {title && <h1 className="font-semibold text-lg">{title}</h1>}
        </div>
        <Sheet>
          <SheetContent side="left" className="w-[80%] max-w-[300px] p-0">
            <SidebarContent
              isLoadingLocations={isLoadingLocations}
              locations={locations}
              selectedLocationId={selectedLocationId}
              handleLocationChange={handleLocationChange}
              showKitchenSelector={showKitchenSelector}
              isLoadingKitchens={isLoadingKitchens}
              availableKitchens={availableKitchens}
              selectedKitchenId={selectedKitchenId}
              handleKitchenChange={handleKitchenChange}
            />
          </SheetContent>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-2">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
        </Sheet>
      </div>


      <ResizablePanelGroup direction="horizontal" className="h-full items-stretch">
        <ResizablePanel
          defaultSize={20}
          minSize={15}
          maxSize={30}
          className="hidden md:flex flex-col border-r bg-muted/30 min-w-[250px] sticky top-0 h-full"
        >
          <ScrollArea className="h-full">
            <div className="flex flex-col h-full">
              <SidebarContent
                isLoadingLocations={isLoadingLocations}
                locations={locations}
                selectedLocationId={selectedLocationId}
                handleLocationChange={handleLocationChange}
                showKitchenSelector={showKitchenSelector}
                isLoadingKitchens={isLoadingKitchens}
                availableKitchens={availableKitchens}
                selectedKitchenId={selectedKitchenId}
                handleKitchenChange={handleKitchenChange}
              />
              <div className="mt-auto px-6 py-4 border-t bg-muted/20">
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold opacity-50">Local Cooks Community</p>
              </div>
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle className="hidden md:flex" />

        <ResizablePanel defaultSize={80} className="flex flex-col min-w-[400px]">
          <ScrollArea className="flex-1">
            <div className="p-4 md:p-8">
              <div className="max-w-6xl mx-auto space-y-6">
                {(title || description) && (
                  <div className="hidden md:block mb-6 space-y-1.5 border-b pb-4">
                    {title && <h2 className="text-2xl font-bold tracking-tight">{title}</h2>}
                    {description && <p className="text-muted-foreground">{description}</p>}
                  </div>
                )}

                {children({
                  selectedLocationId,
                  selectedKitchenId,
                  isLoading: isLoadingLocations || isLoadingKitchens
                })}
              </div>
            </div>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

// Sub-component declared outside to avoid re-renders and lint errors
interface SidebarContentProps {
  isLoadingLocations: boolean;
  locations: any[];
  selectedLocationId: number | null;
  handleLocationChange: (val: string) => void;
  showKitchenSelector: boolean;
  isLoadingKitchens: boolean;
  availableKitchens: any[];
  selectedKitchenId: number | null;
  handleKitchenChange: (val: string) => void;
}

function SidebarContent({
  isLoadingLocations,
  locations,
  selectedLocationId,
  handleLocationChange,
  showKitchenSelector,
  isLoadingKitchens,
  availableKitchens,
  selectedKitchenId,
  handleKitchenChange
}: SidebarContentProps) {
  return (
    <div className="flex flex-col h-full space-y-4 py-8">
      <div className="px-6 pb-2">
        <h1 className="text-xl font-bold tracking-tight">Manager Dashboard</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Control your inventory & bookings</p>
      </div>

      <Separator orientation="horizontal" className="mx-6 w-auto" />

      <div className="flex-1 px-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold mb-1 tracking-tight">Filters</h3>
          <p className="text-xs text-muted-foreground">Manage your view selection</p>
        </div>

        {/* Location Selector */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-3 h-3" /> Location
          </Label>
          {isLoadingLocations ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={selectedLocationId?.toString() || ""}
              onValueChange={handleLocationChange}
            >
              <SelectTrigger className="w-full bg-background transition-all hover:bg-accent/50">
                <SelectValue placeholder="Select Location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id.toString()}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Kitchen Selector */}
        {showKitchenSelector && (
          <div className={cn("space-y-2 transition-opacity duration-200", !selectedLocationId ? "opacity-50 pointer-events-none" : "opacity-100")}>
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <UtensilsCrossed className="w-3 h-3" /> Kitchen
            </Label>
            {isLoadingKitchens ? (
              <Skeleton className="h-10 w-full" />
            ) : availableKitchens.length === 0 && selectedLocationId ? (
              <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-md border border-destructive/20">
                No kitchens found here.
              </div>
            ) : (
              <Select
                value={selectedKitchenId?.toString() || ""}
                onValueChange={handleKitchenChange}
                disabled={!selectedLocationId || availableKitchens.length === 0}
              >
                <SelectTrigger className="w-full bg-background transition-all hover:bg-accent/50">
                  <SelectValue placeholder={selectedLocationId ? "Select Kitchen" : "Choose Location First"} />
                </SelectTrigger>
                <SelectContent>
                  {availableKitchens.map((kitchen) => (
                    <SelectItem key={kitchen.id} value={kitchen.id.toString()}>
                      {kitchen.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}
      </div>

      <div className="mt-auto pt-6"></div>
    </div>
  );
}
