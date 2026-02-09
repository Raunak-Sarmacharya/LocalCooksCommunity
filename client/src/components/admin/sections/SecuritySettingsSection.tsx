import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";
import {
  Shield,
  Save,
  RotateCcw,
  Loader2,
  Globe,
  Lock,
  Zap,
  Webhook,
  Info,
  ShieldOff,
  ShieldCheck,
} from "lucide-react";

interface RateLimitConfig {
  globalWindowMs: number;
  globalMaxRequests: number;
  authWindowMs: number;
  authMaxRequests: number;
  apiWindowMs: number;
  apiMaxRequests: number;
  webhookWindowMs: number;
  webhookMaxRequests: number;
}

interface RateLimitTier {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  windowField: keyof RateLimitConfig;
  maxField: keyof RateLimitConfig;
  color: string;
}

const TIERS: RateLimitTier[] = [
  {
    key: "global",
    label: "Global",
    description: "All requests across the entire API",
    icon: Globe,
    windowField: "globalWindowMs",
    maxField: "globalMaxRequests",
    color: "blue",
  },
  {
    key: "auth",
    label: "Authentication",
    description: "Login, registration, and auth endpoints",
    icon: Lock,
    windowField: "authWindowMs",
    maxField: "authMaxRequests",
    color: "red",
  },
  {
    key: "api",
    label: "API",
    description: "Standard API endpoints (bookings, settings, etc.)",
    icon: Zap,
    windowField: "apiWindowMs",
    maxField: "apiMaxRequests",
    color: "amber",
  },
  {
    key: "webhook",
    label: "Webhooks",
    description: "Stripe and external webhook endpoints",
    icon: Webhook,
    windowField: "webhookWindowMs",
    maxField: "webhookMaxRequests",
    color: "green",
  },
];

function msToMinutes(ms: number): string {
  const minutes = ms / 60000;
  if (minutes >= 1) return `${minutes}`;
  return `${ms / 1000}`;
}

function msToWindowLabel(ms: number): string {
  const minutes = ms / 60000;
  if (minutes >= 1) return `${minutes} min`;
  return `${ms / 1000} sec`;
}

export function SecuritySettingsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [rateLimitsEnabled, setRateLimitsEnabled] = useState<boolean | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string> | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const getFirebaseToken = async (): Promise<string> => {
    const currentFirebaseUser = auth.currentUser;
    if (!currentFirebaseUser) throw new Error("Firebase user not available");
    return await currentFirebaseUser.getIdToken();
  };

  // Fetch current rate limit config
  const { data, isLoading, error } = useQuery<{
    current: RateLimitConfig;
    defaults: RateLimitConfig;
  }>({
    queryKey: ["/api/admin/security/rate-limits"],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/admin/security/rate-limits", {
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) throw new Error("Failed to fetch rate limit settings");
      return response.json();
    },
    staleTime: 30_000,
  });

  // Derive form values from server data (user overrides take precedence)
  const activeFormValues = formValues ?? (data?.current ? {
    globalWindowMs: msToMinutes(data.current.globalWindowMs),
    globalMaxRequests: String(data.current.globalMaxRequests),
    authWindowMs: msToMinutes(data.current.authWindowMs),
    authMaxRequests: String(data.current.authMaxRequests),
    apiWindowMs: msToMinutes(data.current.apiWindowMs),
    apiMaxRequests: String(data.current.apiMaxRequests),
    webhookWindowMs: msToMinutes(data.current.webhookWindowMs),
    webhookMaxRequests: String(data.current.webhookMaxRequests),
  } : {});

  const isRateLimitEnabled = rateLimitsEnabled ?? (data?.current ? data.current.globalMaxRequests < 999999 : true);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, number>) => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/admin/security/rate-limits", {
        method: "PUT",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to update rate limits");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/security/rate-limits"] });
      toast.success("Rate limits updated", {
        description: "Changes take effect immediately across all servers.",
      });
      setHasChanges(false);
      setIsSaving(false);
    },
    onError: (error: Error) => {
      toast.error("Failed to save", { description: error.message });
      setIsSaving(false);
    },
  });

  const handleFieldChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...(prev ?? activeFormValues), [field]: value }));
    setHasChanges(true);
  };

  const handleSave = () => {
    setIsSaving(true);

    // If rate limiting is disabled, set all max values to a very high number
    if (!isRateLimitEnabled) {
      saveMutation.mutate({
        globalMaxRequests: 999999,
        authMaxRequests: 999999,
        apiMaxRequests: 999999,
        webhookMaxRequests: 999999,
      });
      return;
    }

    // Build payload converting window values from minutes to ms
    const payload: Record<string, number> = {};
    for (const tier of TIERS) {
      const windowVal = parseFloat((activeFormValues as Record<string, string>)[tier.windowField] || "0");
      const maxVal = parseInt((activeFormValues as Record<string, string>)[tier.maxField] || "0", 10);
      if (windowVal > 0) payload[tier.windowField] = Math.round(windowVal * 60000);
      if (maxVal > 0) payload[tier.maxField] = maxVal;
    }

    if (Object.keys(payload).length === 0) {
      toast.error("No valid values", { description: "Please enter valid rate limit values." });
      setIsSaving(false);
      return;
    }

    saveMutation.mutate(payload);
  };

  const handleReset = () => {
    if (data?.defaults) {
      const d = data.defaults;
      setFormValues({
        globalWindowMs: msToMinutes(d.globalWindowMs),
        globalMaxRequests: String(d.globalMaxRequests),
        authWindowMs: msToMinutes(d.authWindowMs),
        authMaxRequests: String(d.authMaxRequests),
        apiWindowMs: msToMinutes(d.apiWindowMs),
        apiMaxRequests: String(d.apiMaxRequests),
        webhookWindowMs: msToMinutes(d.webhookWindowMs),
        webhookMaxRequests: String(d.webhookMaxRequests),
      });
      setRateLimitsEnabled(true);
      setHasChanges(true);
    }
  };

  const handleToggleRateLimits = (enabled: boolean) => {
    setRateLimitsEnabled(enabled);
    // When toggling, initialize formValues from server data if not already edited
    if (!formValues && data?.current) {
      setFormValues({
        globalWindowMs: msToMinutes(data.current.globalWindowMs),
        globalMaxRequests: String(data.current.globalMaxRequests),
        authWindowMs: msToMinutes(data.current.authWindowMs),
        authMaxRequests: String(data.current.authMaxRequests),
        apiWindowMs: msToMinutes(data.current.apiWindowMs),
        apiMaxRequests: String(data.current.apiMaxRequests),
        webhookWindowMs: msToMinutes(data.current.webhookWindowMs),
        webhookMaxRequests: String(data.current.webhookMaxRequests),
      });
    }
    setHasChanges(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load security settings. Please refresh and try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h3 className="text-xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security & Rate Limiting
        </h3>
        <p className="text-muted-foreground mt-1">
          Control API rate limits to protect against abuse. Changes take effect immediately.
        </p>
      </div>

      {/* Master Toggle */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isRateLimitEnabled ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100">
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                </div>
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-100">
                  <ShieldOff className="h-5 w-5 text-red-600" />
                </div>
              )}
              <div>
                <p className="font-medium">Rate Limiting</p>
                <p className="text-sm text-muted-foreground">
                  {isRateLimitEnabled
                    ? "Active — API endpoints are protected"
                    : "Disabled — all rate limits are turned off"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isRateLimitEnabled ? "default" : "destructive"}>
                {isRateLimitEnabled ? "Enabled" : "Disabled"}
              </Badge>
              <Switch
                checked={isRateLimitEnabled === true}
                onCheckedChange={handleToggleRateLimits}
              />
            </div>
          </div>
          {!isRateLimitEnabled && (
            <Alert className="mt-4 border-red-200 bg-red-50">
              <Info className="h-4 w-4 text-red-600" />
              <AlertDescription className="text-red-700">
                Rate limiting is disabled. Your API is unprotected against brute-force
                and DDoS attacks. Only disable for debugging — re-enable in production.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Rate Limit Tiers */}
      {isRateLimitEnabled && (
        <div className="grid gap-4 md:grid-cols-2">
          {TIERS.map((tier) => {
            const Icon = tier.icon;
            const windowVal = (activeFormValues as Record<string, string>)[tier.windowField] || "";
            const maxVal = (activeFormValues as Record<string, string>)[tier.maxField] || "";
            const defaultWindow = data?.defaults
              ? msToMinutes(data.defaults[tier.windowField])
              : "—";
            const defaultMax = data?.defaults
              ? String(data.defaults[tier.maxField])
              : "—";

            return (
              <Card key={tier.key}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{tier.label}</CardTitle>
                  </div>
                  <CardDescription className="text-xs">{tier.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Window (minutes)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0.1"
                        step="0.5"
                        value={windowVal}
                        onChange={(e) =>
                          handleFieldChange(tier.windowField, e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        default: {defaultWindow} min
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Max requests per window
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={maxVal}
                        onChange={(e) =>
                          handleFieldChange(tier.maxField, e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        default: {defaultMax}
                      </span>
                    </div>
                  </div>
                  {windowVal && maxVal && (
                    <p className="text-xs text-muted-foreground pt-1 border-t">
                      ≈ {Math.round(parseInt(maxVal) / parseFloat(windowVal))} req/min
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Current Status Summary */}
      {isRateLimitEnabled && data?.current && (
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Current Active Limits</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {TIERS.map((tier) => (
                <div key={tier.key} className="text-center">
                  <p className="text-xs text-muted-foreground">{tier.label}</p>
                  <p className="text-sm font-semibold">
                    {data.current[tier.maxField].toLocaleString()} / {msToWindowLabel(data.current[tier.windowField])}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
          {isSaving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button variant="outline" onClick={handleReset} disabled={isSaving}>
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset to Defaults
        </Button>
        {hasChanges && (
          <Badge variant="secondary" className="ml-2">
            Unsaved changes
          </Badge>
        )}
      </div>
    </div>
  );
}
