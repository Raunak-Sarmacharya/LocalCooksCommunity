/// <reference types="@types/google.maps" />

import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MapPin, Loader2 } from 'lucide-react';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Enter address...",
  className,
  disabled = false
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<any>(null);
  const placesRef = useRef<any>(null);

  useEffect(() => {
    // Initialize Google Places services
    if (window.google && window.google.maps && window.google.maps.places) {
      autocompleteRef.current = new window.google.maps.places.AutocompleteService();
      placesRef.current = new window.google.maps.places.PlacesService(document.createElement('div'));
    }
  }, []);

  const handleInputChange = async (inputValue: string) => {
    onChange(inputValue);
    
    if (!inputValue || inputValue.length < 3) {
      setPredictions([]);
      setIsOpen(false);
      return;
    }

    if (!autocompleteRef.current) return;

    setIsLoading(true);
    
    try {
      const request = {
        input: inputValue,
        types: ['address'],
        componentRestrictions: { country: ['us', 'ca'] } // Restrict to US and Canada
      };

      autocompleteRef.current.getPlacePredictions(request, (predictions: any, status: any) => {
        if (status === window.google?.maps?.places?.PlacesServiceStatus.OK && predictions) {
          setPredictions(predictions);
          setIsOpen(true);
        } else {
          setPredictions([]);
          setIsOpen(false);
        }
        setIsLoading(false);
      });
    } catch (error) {
      console.error('Error fetching predictions:', error);
      setPredictions([]);
      setIsOpen(false);
      setIsLoading(false);
    }
  };

  const handleSelectPlace = (place: any) => {
    if (!placesRef.current) return;

    placesRef.current.getDetails(
      { placeId: place.place_id },
      (result: any, status: any) => {
        if (status === window.google?.maps?.places?.PlacesServiceStatus.OK && result) {
          const formattedAddress = result.formatted_address || place.description;
          onChange(formattedAddress);
          setPredictions([]);
          setIsOpen(false);
        }
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setPredictions([]);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "pr-10",
            className
          )}
        />
        <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : (
            <MapPin className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {isOpen && predictions.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {predictions.map((prediction) => (
            <button
              key={prediction.place_id}
              type="button"
              onClick={() => handleSelectPlace(prediction)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-start gap-2"
            >
              <MapPin className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                  {prediction.structured_formatting?.main_text}
                </div>
                <div className="text-slate-500 dark:text-slate-400 text-xs truncate">
                  {prediction.structured_formatting?.secondary_text}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Type declaration for Google Maps
declare global {
  interface Window {
    google?: any;
  }
}
