import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { MapPin, Loader2 } from 'lucide-react';

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text?: string;
    secondary_text?: string;
  };
}

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

// Debounce helper to prevent excessive API calls
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export default function AddressAutocomplete({
  value,
  onChange,
  placeholder = "Enter address...",
  className,
  disabled = false
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounce the input to prevent excessive API calls
  const debouncedInput = useDebounce(inputValue, 300);

  // Sync external value changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Fetch predictions from server proxy when debounced input changes
  useEffect(() => {
    const fetchPredictions = async () => {
      if (!debouncedInput || debouncedInput.length < 3) {
        setPredictions([]);
        setIsOpen(false);
        return;
      }

      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          input: debouncedInput,
          types: 'address',
          components: 'country:us|country:ca'
        });

        const response = await fetch(`/api/places/autocomplete?${params}`, {
          signal: abortControllerRef.current.signal
        });

        if (!response.ok) {
          throw new Error('Failed to fetch predictions');
        }

        const data = await response.json();

        if (data.status === 'OK' && data.predictions) {
          setPredictions(data.predictions);
          setIsOpen(true);
        } else {
          setPredictions([]);
          setIsOpen(false);
        }
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.error('Error fetching predictions:', error);
          setPredictions([]);
          setIsOpen(false);
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchPredictions();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [debouncedInput]);

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    onChange(newValue);
  };

  const handleSelectPlace = useCallback(async (place: Prediction) => {
    setIsLoading(true);
    
    try {
      const params = new URLSearchParams({
        place_id: place.place_id
      });

      const response = await fetch(`/api/places/details?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch place details');
      }

      const data = await response.json();

      if (data.status === 'OK' && data.result) {
        const formattedAddress = data.result.formatted_address || place.description;
        setInputValue(formattedAddress);
        onChange(formattedAddress);
      } else {
        // Fallback to description if details fail
        setInputValue(place.description);
        onChange(place.description);
      }
    } catch (error) {
      console.error('Error fetching place details:', error);
      // Fallback to description
      setInputValue(place.description);
      onChange(place.description);
    } finally {
      setPredictions([]);
      setIsOpen(false);
      setIsLoading(false);
    }
  }, [onChange]);

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
          value={inputValue}
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
