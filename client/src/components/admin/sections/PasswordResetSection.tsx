import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  CheckCircle,
  Copy,
  KeyRound,
  Loader2,
  Search,
  User as UserIcon,
  Link as LinkIcon,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebase";

interface PasswordResetSectionProps {
  getFirebaseToken: () => Promise<string>;
}

interface UserResult {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  displayText: string;
}

export function PasswordResetSection({ getFirebaseToken }: PasswordResetSectionProps) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Search users query
  const { data: searchResults, isLoading: isSearching } = useQuery<{ users: UserResult[] }>({
    queryKey: ["/api/admin/users", searchQuery],
    queryFn: async () => {
      const token = await getFirebaseToken();
      const response = await fetch(`/api/admin/users?search=${encodeURIComponent(searchQuery)}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to search users");
      return response.json();
    },
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  });

  // Generate reset link mutation
  const generateLinkMutation = useMutation({
    mutationFn: async (email: string) => {
      const token = await getFirebaseToken();
      const response = await fetch("/api/admin/generate-password-reset-link", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate password reset link");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setGeneratedLink(data.resetLink);
      setCopied(false);
      toast.success("Reset link generated", {
        description: `Password reset link created for ${data.userEmail}`,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to generate link", {
        description: error.message,
      });
    },
  });

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await navigator.clipboard.writeText(generatedLink);
      setCopied(true);
      toast.success("Copied!", { description: "Reset link copied to clipboard" });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      toast.error("Copy failed", { description: "Please select and copy manually" });
    }
  };

  const handleSelectUser = (user: UserResult) => {
    setSelectedUser(user);
    setGeneratedLink(null);
    setCopied(false);
  };

  const handleGenerateLink = () => {
    if (!selectedUser) return;
    generateLinkMutation.mutate(selectedUser.email);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return <Badge className="bg-purple-100 text-purple-700 border-purple-200">Admin</Badge>;
      case "manager":
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200">Manager</Badge>;
      case "chef":
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Chef</Badge>;
      default:
        return <Badge variant="outline">{role}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold">Password Reset Link Generator</h3>
        <p className="text-sm text-muted-foreground">
          Generate a password reset link for any user and share it directly — no email required.
        </p>
      </div>

      {/* Step 1: Search for user */}
      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              1
            </div>
            <h4 className="font-medium">Search for a user</h4>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="password-reset-user-search"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedUser(null);
                setGeneratedLink(null);
              }}
              className="pl-9"
            />
          </div>

          {/* Search results */}
          {isSearching && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching...
            </div>
          )}

          {searchResults?.users && searchResults.users.length > 0 && !selectedUser && (
            <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
              {searchResults.users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      <UserIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{user.fullName}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  {getRoleBadge(user.role)}
                </button>
              ))}
            </div>
          )}

          {searchQuery.length >= 2 &&
            !isSearching &&
            searchResults?.users &&
            searchResults.users.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <AlertCircle className="h-4 w-4" />
                No users found matching "{searchQuery}"
              </div>
            )}

          {/* Selected user card */}
          {selectedUser && (
            <div className="flex items-center justify-between bg-muted/50 border rounded-lg px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                  <UserIcon className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{selectedUser.fullName}</p>
                  <p className="text-xs text-muted-foreground">{selectedUser.email}</p>
                </div>
                {getRoleBadge(selectedUser.role)}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedUser(null);
                  setGeneratedLink(null);
                  setSearchQuery("");
                }}
              >
                Change
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Generate link */}
      <Card className={!selectedUser ? "opacity-50 pointer-events-none" : ""}>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
              2
            </div>
            <h4 className="font-medium">Generate reset link</h4>
          </div>

          {!generatedLink ? (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 border border-amber-200">
                <KeyRound className="h-7 w-7 text-amber-600" />
              </div>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                This will generate a one-time password reset link for{" "}
                <strong>{selectedUser?.email || "the selected user"}</strong>. The link can be shared
                directly via chat, SMS, or any other channel.
              </p>
              <Button
                onClick={handleGenerateLink}
                disabled={generateLinkMutation.isPending || !selectedUser}
                className="gap-2"
              >
                {generateLinkMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <LinkIcon className="h-4 w-4" />
                    Generate Reset Link
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Success banner */}
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                <p className="text-sm text-emerald-800">
                  Reset link generated successfully! Share this link with the user.
                </p>
              </div>

              {/* Link display */}
              <div className="bg-muted/50 border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Password Reset Link
                  </p>
                  <Badge variant="outline" className="text-xs">
                    One-time use
                  </Badge>
                </div>
                <div className="bg-background border rounded-md p-3">
                  <p className="text-sm font-mono break-all select-all text-foreground/80">
                    {generatedLink}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleCopyLink}
                    variant={copied ? "default" : "outline"}
                    size="sm"
                    className="gap-2"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="h-3.5 w-3.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy Link
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={() => window.open(generatedLink, "_blank")}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Browser
                  </Button>
                </div>
              </div>

              {/* Warning */}
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800">
                  This link expires after use or within a limited time window (set by Firebase).
                  Generate a new link if this one expires.
                </p>
              </div>

              {/* Generate another */}
              <Button
                onClick={() => {
                  setSelectedUser(null);
                  setGeneratedLink(null);
                  setSearchQuery("");
                  setCopied(false);
                }}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Generate for Another User
              </Button>
            </div>
          )}

          {/* Error state */}
          {generateLinkMutation.isError && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
              <p className="text-sm text-red-800">
                {generateLinkMutation.error?.message || "Failed to generate reset link"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
