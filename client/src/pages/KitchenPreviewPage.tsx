import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Building2, MapPin, Loader2, ArrowRight, Calendar, Lock, 
  ChevronLeft, ChevronRight, Utensils, Sparkles, Check, ImageOff
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useEffect, useCallback } from "react";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import useEmblaCarousel from 'embla-carousel-react';

interface PublicLocation {
  id: number;
  name: string;
  address: string;
  logoUrl?: string | null;
  brandImageUrl?: string | null;
}

interface PublicKitchen {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  galleryImages?: string[] | null;
  amenities?: string[] | null;
  locationId: number;
  locationName?: string | null;
  locationAddress?: string | null;
}

// Helper functions for mini calendar
function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function getMiniCalendarDays(year: number, month: number) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const days: (number | null)[] = [];
  
  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day);
  }
  
  return days;
}

// Compact Kitchen Selection Card
function KitchenSelectionCard({ 
  kitchen, 
  isSelected, 
  onSelect 
}: { 
  kitchen: PublicKitchen; 
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <motion.button
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`
        w-full text-left p-3 rounded-xl border-2 transition-all duration-200
        ${isSelected 
          ? 'border-[#F51042] bg-[#F51042]/5 shadow-md' 
          : 'border-gray-200 hover:border-[#F51042]/50 hover:bg-gray-50 bg-white'
        }
      `}
    >
      <div className="flex items-center gap-3">
        {/* Thumbnail */}
        <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
          {kitchen.imageUrl ? (
            <img 
              src={kitchen.imageUrl} 
              alt={kitchen.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200">
              <Utensils className="w-5 h-5 text-gray-400" />
            </div>
          )}
        </div>
        
        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm truncate">{kitchen.name}</h3>
          {kitchen.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{kitchen.description}</p>
          )}
        </div>
        
        {/* Selected indicator */}
        {isSelected && (
          <div className="w-6 h-6 rounded-full bg-[#F51042] flex items-center justify-center flex-shrink-0">
            <Check className="w-3.5 h-3.5 text-white" />
          </div>
        )}
      </div>
    </motion.button>
  );
}

// Image Carousel Component
function ImageCarousel({ images, kitchenName }: { images: string[]; kitchenName: string }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on('select', onSelect);
    emblaApi.on('reInit', onSelect);
    return () => {
      emblaApi.off('select', onSelect);
      emblaApi.off('reInit', onSelect);
    };
  }, [emblaApi, onSelect]);

  if (images.length === 0) {
    return (
      <div className="aspect-[16/9] bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex flex-col items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center mb-4">
          <ImageOff className="w-10 h-10 text-gray-400" />
        </div>
        <p className="text-gray-500 font-medium">No images available</p>
        <p className="text-gray-400 text-sm mt-1">Photos coming soon</p>
      </div>
    );
  }

  return (
    <div className="relative group">
      {/* Main Carousel */}
      <div className="overflow-hidden rounded-xl" ref={emblaRef}>
        <div className="flex">
          {images.map((img, index) => (
            <div key={index} className="flex-[0_0_100%] min-w-0">
              <div className="aspect-[16/9] bg-gray-100">
                <img 
                  src={img} 
                  alt={`${kitchenName} - Image ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation Arrows */}
      {images.length > 1 && (
        <>
          <button
            onClick={scrollPrev}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
            disabled={!canScrollPrev}
          >
            <ChevronLeft className="w-5 h-5 text-gray-700" />
          </button>
          <button
            onClick={scrollNext}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 hover:bg-white rounded-full shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-30"
            disabled={!canScrollNext}
          >
            <ChevronRight className="w-5 h-5 text-gray-700" />
          </button>
        </>
      )}

      {/* Dots Indicator */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
          {images.map((_, index) => (
            <button
              key={index}
              onClick={() => emblaApi?.scrollTo(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === selectedIndex 
                  ? 'bg-white w-6' 
                  : 'bg-white/50 hover:bg-white/75'
              }`}
            />
          ))}
        </div>
      )}

      {/* Image Counter */}
      <div className="absolute top-4 right-4 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full">
        {selectedIndex + 1} / {images.length}
      </div>
    </div>
  );
}

// Mini Calendar Component - Non-interactive preview with clear visibility
function MiniCalendarPreview() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();
  const days = getMiniCalendarDays(currentYear, currentMonth);
  const todayDate = today.getDate();
  
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  return (
    <div className="relative">
      {/* Calendar Content - Fully visible */}
      <div className="p-4">
        {/* Month/Year Header */}
        <div className="text-center mb-4">
          <h3 className="text-base font-bold text-gray-800">
            {monthNames[currentMonth]} {currentYear}
          </h3>
        </div>
        
        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
            <div key={i} className="text-[10px] text-gray-500 font-semibold text-center py-1">
              {d}
            </div>
          ))}
        </div>
        
        {/* Calendar Days */}
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, index) => {
            if (day === null) {
              return <div key={index} className="aspect-square" />;
            }
            
            const isPast = day < todayDate;
            const isToday = day === todayDate;
            
            return (
              <div 
                key={index}
                className={`
                  aspect-square flex items-center justify-center rounded-md text-xs font-medium
                  transition-colors
                  ${isPast ? 'text-gray-300 bg-gray-50' : 'text-gray-700 bg-white'}
                  ${isToday 
                    ? 'bg-[#F51042] text-white font-bold ring-2 ring-[#F51042]/30' 
                    : ''
                  }
                `}
              >
                {day}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overlay - Semi-transparent to show calendar underneath */}
      <div className="absolute inset-0 bg-white/70 z-10 flex items-center justify-center rounded-b-lg">
        <div className="text-center px-4 py-3 bg-white/90 rounded-xl shadow-lg border border-gray-100">
          <div className="w-10 h-10 mx-auto mb-2 bg-[#F51042]/10 rounded-full flex items-center justify-center">
            <Lock className="w-5 h-5 text-[#F51042]" />
          </div>
          <p className="text-sm font-semibold text-gray-800">Sign in to book</p>
          <p className="text-xs text-gray-500 mt-1">View availability & reserve</p>
        </div>
      </div>
    </div>
  );
}

// Kitchen Details Section
function KitchenDetailsSection({ kitchen }: { kitchen: PublicKitchen }) {
  // Combine main image with gallery images for carousel
  const allImages: string[] = [];
  if (kitchen.imageUrl) allImages.push(kitchen.imageUrl);
  if (kitchen.galleryImages && Array.isArray(kitchen.galleryImages)) {
    allImages.push(...kitchen.galleryImages.filter(img => img && typeof img === 'string'));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Image Carousel */}
      <ImageCarousel images={allImages} kitchenName={kitchen.name} />

      {/* Kitchen Info Card */}
      <Card className="border-gray-200 overflow-hidden">
        <CardContent className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{kitchen.name}</h2>
          
          {kitchen.description ? (
            <p className="text-gray-600 leading-relaxed mb-6">{kitchen.description}</p>
          ) : (
            <p className="text-gray-400 italic mb-6">
              Kitchen details will be available soon. Contact us for more information.
            </p>
          )}

          {/* Amenities */}
          {kitchen.amenities && Array.isArray(kitchen.amenities) && kitchen.amenities.length > 0 && (
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">
                Kitchen Amenities
              </h3>
              <div className="flex flex-wrap gap-2">
                {kitchen.amenities.map((amenity, index) => (
                  <span 
                    key={index}
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-700"
                  >
                    <Check className="w-3.5 h-3.5 text-green-500 mr-1.5" />
                    {amenity}
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function KitchenPreviewPage() {
  const [locationPath, navigate] = useLocation();
  
  const locationIdMatch = locationPath.match(/\/kitchen-preview\/(\d+)/);
  const locationId = locationIdMatch ? parseInt(locationIdMatch[1]) : null;

  const [selectedKitchen, setSelectedKitchen] = useState<PublicKitchen | null>(null);

  const { data: locationData, isLoading, error } = useQuery<{ 
    location: PublicLocation; 
    kitchens: PublicKitchen[];
  }>({
    queryKey: [`/api/public/locations/${locationId}/details`],
    queryFn: async () => {
      const response = await fetch(`/api/public/locations/${locationId}/details`);
      if (!response.ok) throw new Error("Location not found");
      return response.json();
    },
    enabled: !!locationId,
  });

  useEffect(() => {
    if (locationData?.kitchens?.length && !selectedKitchen) {
      setSelectedKitchen(locationData.kitchens[0]);
    }
  }, [locationData?.kitchens, selectedKitchen]);

  const handleGetStarted = () => {
    navigate(`/auth?redirect=/portal/book`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-[#F51042] mx-auto mb-3" />
          <p className="text-gray-600">Loading kitchens...</p>
        </div>
      </div>
    );
  }

  if (error || !locationData) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="text-center max-w-md mx-auto px-4">
            <ImageOff className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Location Not Found</h1>
            <p className="text-gray-600 mb-6">This kitchen location doesn't exist or has been removed.</p>
            <Button onClick={() => navigate('/')} className="bg-[#F51042] hover:bg-[#D90E3A]">
              Back to Home
            </Button>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const { location, kitchens } = locationData;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      
      <main className="flex-1 pt-20 pb-12">
        {/* Location Header - Compact */}
        <div className="bg-white border-b border-gray-200 py-5">
          <div className="container mx-auto px-4 max-w-7xl">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                {location.logoUrl ? (
                  <img 
                    src={location.logoUrl} 
                    alt={location.name}
                    className="h-12 w-auto rounded-lg"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-[#F51042] to-[#FF6B7A] flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-white" />
                  </div>
                )}
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{location.name}</h1>
                  <div className="flex items-center gap-1.5 text-gray-500 text-sm">
                    <MapPin className="h-3.5 w-3.5" />
                    <span>{location.address}</span>
                  </div>
                </div>
              </div>
              
              <Button 
                onClick={handleGetStarted}
                className="bg-[#F51042] hover:bg-[#D90E3A] text-white"
              >
                Sign In to Book
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="container mx-auto px-4 max-w-7xl py-8">
          <div className="grid lg:grid-cols-12 gap-8">
            {/* Left Sidebar - Kitchen Selection */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h2 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
                  Select a Kitchen
                </h2>
                <div className="space-y-2">
                  {kitchens.map((kitchen) => (
                    <KitchenSelectionCard
                      key={kitchen.id}
                      kitchen={kitchen}
                      isSelected={selectedKitchen?.id === kitchen.id}
                      onSelect={() => setSelectedKitchen(kitchen)}
                    />
                  ))}
                </div>
                
                {kitchens.length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <Utensils className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                    <p className="text-sm">No kitchens available</p>
                  </div>
                )}
              </div>

              {/* Mini Calendar */}
              <Card className="overflow-hidden border-gray-200">
                <div className="bg-gradient-to-r from-[#F51042] to-[#FF6B7A] p-3 text-white">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    <span className="font-semibold text-sm">Availability</span>
                  </div>
                </div>
                <CardContent className="p-0">
                  <MiniCalendarPreview />
                </CardContent>
              </Card>

              {/* CTA Card */}
              <Card className="border-gray-200 overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="h-4 w-4 text-[#F51042]" />
                    <span className="font-semibold text-gray-900 text-sm">Ready to Cook?</span>
                  </div>
                  <p className="text-xs text-gray-600 mb-3">
                    Create a free account to view availability and book.
                  </p>
                  <Button 
                    onClick={handleGetStarted}
                    className="w-full bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold text-sm"
                    size="sm"
                  >
                    Get Started Free
                    <ArrowRight className="ml-2 h-3.5 w-3.5" />
                  </Button>
                  <p className="text-center text-xs text-gray-500 mt-2">
                    Already have an account?{' '}
                    <button 
                      onClick={() => navigate('/auth')} 
                      className="text-[#F51042] hover:underline font-medium"
                    >
                      Log in
                    </button>
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Main Content - Selected Kitchen Details */}
            <div className="lg:col-span-9">
              <AnimatePresence mode="wait">
                {selectedKitchen ? (
                  <KitchenDetailsSection key={selectedKitchen.id} kitchen={selectedKitchen} />
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex items-center justify-center h-96 bg-white rounded-xl border border-gray-200"
                  >
                    <div className="text-center">
                      <Utensils className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500">Select a kitchen to view details</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Bottom CTA Banner */}
        <div className="bg-gradient-to-r from-gray-900 to-gray-800 mt-12">
          <div className="container mx-auto px-4 max-w-7xl py-10">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="text-center md:text-left">
                <h3 className="text-xl font-bold text-white mb-1">
                  Start Cooking at {location.name}
                </h3>
                <p className="text-gray-400 text-sm">
                  Join LocalCooks and get access to professional kitchen spaces
                </p>
              </div>
              <div className="flex gap-3">
                <Button 
                  onClick={handleGetStarted}
                  className="bg-[#F51042] hover:bg-[#D90E3A] text-white font-semibold"
                >
                  Create Free Account
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button 
                  onClick={() => navigate('/auth')}
                  variant="outline"
                  className="border-gray-600 text-white hover:bg-gray-700"
                >
                  Log In
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
