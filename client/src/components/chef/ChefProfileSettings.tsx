import { logger } from "@/lib/logger";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { updateProfile } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Loader2,
  KeyRound,
  Camera,
  Edit3,
  Lock,
  X,
  Info,
} from "lucide-react";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import ChangePassword from "@/components/auth/ChangePassword";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { motion } from "framer-motion";
import { StatusDot } from "@/components/chef/ui";
import { InfoChip } from "@/components/chef/info-chip";

type EditableField = "displayName" | "username" | "phone";

export default function ChefProfileSettings() {
  const { t } = useTranslation("chef");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: firebaseUser } = useFirebaseAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [draft, setDraft] = useState("");

  const { uploadFile, isUploading } = useFileUpload({
    maxSize: 2 * 1024 * 1024,
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    onSuccess: (response) => {
      setAvatarUrl(response.url);
      updateProfileMutation.mutate({ profileImageUrl: response.url });
    },
    onError: (error) => {
      toast({
        title: t("profileUploadFailedTitle", "Upload failed"),
        description: error,
        variant: "destructive",
      });
    },
  });

  const { data: user, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["/api/user/profile", firebaseUser?.uid],
    queryFn: async () => {
      if (!firebaseUser) return null;
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/user/profile", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) {
          if (response.status === 401) return null;
          throw new Error(`Failed to fetch profile: ${response.status}`);
        }
        return await response.json();
      } catch (error) {
        logger.error("Error fetching user profile:", error);
        return null;
      }
    },
    enabled: !!firebaseUser,
  });

  const { data: chefProfile, isLoading: isLoadingDetails } = useQuery({
    queryKey: ["/api/chef/my-profile"],
    queryFn: async () => {
      try {
        const currentFirebaseUser = auth.currentUser;
        if (!currentFirebaseUser) return null;
        const token = await currentFirebaseUser.getIdToken();
        const response = await fetch("/api/chef/my-profile", {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });
        if (!response.ok) {
          if (response.status === 404) {
            return {
              phone: null,
              displayName: null,
              profileImageUrl: null,
              applicationStatus: null,
            };
          }
          throw new Error(`Failed to fetch chef profile: ${response.status}`);
        }
        return response.json();
      } catch (error) {
        logger.error("Error fetching chef profile:", error);
        return {
          phone: null,
          displayName: null,
          profileImageUrl: null,
          applicationStatus: null,
        };
      }
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setEmail(user.email || firebaseUser?.email || "");
    }
    const firebaseDisplayName = auth.currentUser?.displayName;
    if (firebaseDisplayName) {
      setDisplayName(firebaseDisplayName);
    } else if (chefProfile?.displayName) {
      setDisplayName(chefProfile.displayName);
    } else if (user?.displayName || user?.fullName) {
      setDisplayName(user.displayName || user.fullName || "");
    }
    if (chefProfile) {
      setPhone(chefProfile.phone || "");
      if (chefProfile.profileImageUrl) {
        setAvatarUrl(chefProfile.profileImageUrl);
      }
    }
  }, [user, chefProfile, firebaseUser]);

  const getApplicationStatusDisplay = (status: string | null) => {
    switch (status) {
      case "approved":
        return {
          label: t("profileStatusApproved", "Approved"),
          tone: "success" as const,
        };
      case "pending":
        return {
          label: t("profileStatusPending", "Pending"),
          tone: "warning" as const,
        };
      case "rejected":
        return {
          label: t("profileStatusRejected", "Rejected"),
          tone: "danger" as const,
        };
      default:
        return null;
    }
  };

  const updateProfileMutation = useMutation({
    mutationFn: async (profileData: {
      username?: string;
      displayName?: string;
      phone?: string;
      profileImageUrl?: string;
    }) => {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error(tt("notAuthenticated"));

      if (profileData.displayName) {
        try {
          await updateProfile(currentFirebaseUser, {
            displayName: profileData.displayName,
          });
        } catch (firebaseError) {
          logger.error("Failed to update Firebase Auth displayName:", firebaseError);
        }
      }

      const token = await currentFirebaseUser.getIdToken();
      const response = await fetch("/api/chef/my-profile", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(profileData),
      });

      if (!response.ok) throw new Error(tt("failedToUpdateProfile"));
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/my-profile"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/user/profile", firebaseUser?.uid],
      });
      if (variables.displayName !== undefined) setDisplayName(variables.displayName);
      if (variables.username !== undefined) setUsername(variables.username);
      if (variables.phone !== undefined) setPhone(variables.phone);
      setEditingField(null);
      setDraft("");
      toast({
        title: t("profileUpdatedTitle", "Profile updated"),
        description: t(
          "profileUpdatedDesc",
          "Your changes have been saved successfully."
        ),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("profileUpdateFailedTitle", "Update failed"),
        description:
          error.message ||
          t("profileUpdateFailedDefaultDesc", "Failed to update profile"),
        variant: "destructive",
      });
    },
  });

  const startEdit = (field: EditableField, current: string) => {
    setEditingField(field);
    setDraft(current);
  };

  const cancelEdit = () => {
    setEditingField(null);
    setDraft("");
  };

  const saveFieldAction = useStatusButton(
    useCallback(async () => {
      if (!editingField) return;
      const trimmed = draft.trim();
      const original =
        editingField === "displayName"
          ? displayName
          : editingField === "username"
            ? username
            : phone;
      if (trimmed === original.trim()) return;
      if (editingField === "displayName") {
        await updateProfileMutation.mutateAsync({ displayName: trimmed });
      } else if (editingField === "username") {
        await updateProfileMutation.mutateAsync({ username: trimmed });
      } else {
        await updateProfileMutation.mutateAsync({ phone: trimmed });
      }
    }, [
      editingField,
      draft,
      displayName,
      username,
      phone,
      updateProfileMutation,
    ])
  );

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
  };

  const getInitials = () => {
    if (displayName) {
      return displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }
    if (email) return email[0].toUpperCase();
    return "CH";
  };

  if (isLoadingProfile || isLoadingDetails) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 pb-16">
        <div className="h-44 animate-pulse rounded-[1.35rem] bg-muted" />
        <div className="h-10 w-64 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-[1.35rem] bg-muted" />
      </div>
    );
  }

  const appStatus = getApplicationStatusDisplay(
    chefProfile?.applicationStatus ?? null
  );
  const photoSrc = avatarUrl || firebaseUser?.photoURL || undefined;

  return (
    <div className="relative mx-auto max-w-4xl space-y-8 pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[-1rem] -top-4 -z-10 h-72 rounded-[2rem] bg-[radial-gradient(ellipse_at_28%_20%,hsl(348_85%_59%_/_0.1),transparent_58%)]"
      />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-[1.35rem] border bg-card"
      >
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,hsl(348_85%_59%_/_0.08),transparent)]"
        />
        <div className="relative flex flex-col items-center gap-5 px-6 py-8 sm:flex-row sm:items-center sm:gap-7 sm:px-8">
          <div className="relative shrink-0">
            <Avatar className="h-24 w-24 border-2 border-background shadow-md ring-2 ring-primary/20 sm:h-28 sm:w-28">
              <AvatarImage src={photoSrc} alt={displayName} className="object-cover" />
              <AvatarFallback className="bg-primary/10 text-2xl font-semibold text-primary">
                {getInitials()}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={handleAvatarClick}
              disabled={isUploading}
              className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border bg-background text-foreground shadow-sm transition hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("profileChangePhoto", "Change photo")}
            >
              {isUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarChange}
              className="hidden"
            />
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="font-display text-xl leading-none text-primary sm:text-2xl">
              Local Cooks
            </p>
            <h2 className="mt-2 truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {displayName || t("profileYourName", "Your Name")}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <p className="truncate text-sm text-muted-foreground">{email}</p>
              <InfoChip
                tone={user?.isVerified ? "success" : "warning"}
                className="shrink-0 px-2 py-1"
              >
                {user?.isVerified
                  ? t("profileVerifiedBadge", "Verified")
                  : t("pfPending", "Pending")}
              </InfoChip>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground sm:justify-start">
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="progress" className="bg-primary" />
                <span>{t("profileChefBadge", "Chef")}</span>
              </span>
              {appStatus ? (
                <>
                  <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
                  <span className="inline-flex items-center gap-2">
                    <StatusDot tone={appStatus.tone} />
                    <span>{appStatus.label}</span>
                  </span>
                </>
              ) : null}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground/70 transition hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={t("pfAccountStatus")}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-80 space-y-3 p-3 sm:w-96"
                >
                  <p className="text-sm font-medium text-foreground">
                    {t("pfAccountStatus")}
                  </p>
                  <ul className="space-y-2">
                    <IntegrityRow
                      label={t("pfAccountType")}
                      value={t("pfRoleChef")}
                      tone="progress"
                    />
                    {appStatus ? (
                      <IntegrityRow
                        label={t("pfApplication")}
                        value={appStatus.label}
                        tone={appStatus.tone}
                      />
                    ) : null}
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      </motion.section>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="account"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t("profileTabAccount", "Account details")}
          </TabsTrigger>
          <TabsTrigger
            value="security"
            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t("profileTabSecurity", "Security")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="account" className="mt-6 focus-visible:ring-0">
          <Section
            title={t("profilePersonalInformation", "Personal Information")}
            description={t(
              "profilePublicProfileDetails",
              "Your public profile details"
            )}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <FieldRow
                label={t("profileDisplayName", "Display Name")}
                value={displayName || "—"}
                original={displayName}
                editing={editingField === "displayName"}
                draft={draft}
                onDraftChange={setDraft}
                onEdit={() => startEdit("displayName", displayName)}
                onCancel={cancelEdit}
                onSave={saveFieldAction.execute}
                saveStatus={saveFieldAction.status}
                inputId="displayName"
                placeholder={t("profileDisplayNamePlaceholder", "John Doe")}
                saveLabels={{
                  idle: t("profileSaveChanges", "Save"),
                  loading: t("profileSaving", "Saving"),
                  success: t("profileSaved", "Saved"),
                }}
                cancelLabel={t("profileCancel", "Cancel")}
                editLabel={t("profileEdit", "Edit")}
              />
              <FieldRow
                label={t("profileUsername", "Username")}
                value={username || "—"}
                original={username}
                editing={editingField === "username"}
                draft={draft}
                onDraftChange={setDraft}
                onEdit={() => startEdit("username", username)}
                onCancel={cancelEdit}
                onSave={saveFieldAction.execute}
                saveStatus={saveFieldAction.status}
                inputId="username"
                placeholder={t("profileUsernamePlaceholder", "johndoe")}
                saveLabels={{
                  idle: t("profileSaveChanges", "Save"),
                  loading: t("profileSaving", "Saving"),
                  success: t("profileSaved", "Saved"),
                }}
                cancelLabel={t("profileCancel", "Cancel")}
                editLabel={t("profileEdit", "Edit")}
              />
              <FieldRow
                label={t("profilePhoneNumber", "Phone Number")}
                value={phone || "—"}
                original={phone}
                editing={editingField === "phone"}
                draft={draft}
                onDraftChange={setDraft}
                onEdit={() => startEdit("phone", phone)}
                onCancel={cancelEdit}
                onSave={saveFieldAction.execute}
                saveStatus={saveFieldAction.status}
                inputId="phone"
                inputType="tel"
                placeholder={t("profilePhonePlaceholder", "+1 (555) 000-0000")}
                saveLabels={{
                  idle: t("profileSaveChanges", "Save"),
                  loading: t("profileSaving", "Saving"),
                  success: t("profileSaved", "Saved"),
                }}
                cancelLabel={t("profileCancel", "Cancel")}
                editLabel={t("profileEdit", "Edit")}
              />
              <div className="rounded-xl border bg-muted/30 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("profileEmailAddress", "Email Address")}
                    </p>
                    <p className="truncate text-sm font-medium text-foreground">
                      {email || "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-background hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t(
                            "profileEmailLinkedNotice",
                            "Email is linked to your authentication and cannot be changed here"
                          )}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-72 p-3">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {t(
                            "profileEmailLinkedNotice",
                            "Email is linked to your authentication and cannot be changed here"
                          )}
                        </p>
                      </PopoverContent>
                    </Popover>
                    <span className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground/50">
                      <Lock className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </TabsContent>

        <TabsContent value="security" className="mt-6 focus-visible:ring-0">
          <Section
            title={t("pfSecurityTitle")}
            description={t("pfSecurityDesc")}
            icon={<KeyRound className="h-4 w-4 text-primary" />}
          >
            <ChangePassword role="chef" embedded />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FieldRow({
  label,
  value,
  original,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onSave,
  saveStatus,
  inputId,
  inputType = "text",
  placeholder,
  saveLabels,
  cancelLabel,
  editLabel,
}: {
  label: string;
  value: string;
  original: string;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saveStatus: "idle" | "loading" | "success" | "error";
  inputId: string;
  inputType?: string;
  placeholder?: string;
  saveLabels: { idle: string; loading: string; success: string };
  cancelLabel: string;
  editLabel: string;
}) {
  const isDirty = draft.trim() !== original.trim();

  if (editing) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3 ring-1 ring-primary/20">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Input
          id={inputId}
          type={inputType}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={placeholder}
          className="mt-2 h-10"
          autoFocus
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            <X className="mr-1 h-3.5 w-3.5" />
            {cancelLabel}
          </Button>
          <StatusButton
            size="sm"
            status={saveStatus}
            onClick={onSave}
            labels={saveLabels}
            disabled={!isDirty}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="truncate text-sm font-medium text-foreground">{value}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Edit3 className="h-3.5 w-3.5" aria-hidden />
          {editLabel}
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.35rem] border bg-card">
      <div className="flex items-start gap-3 border-b px-5 py-4 sm:px-6">
        {icon ? (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-primary/5">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  );
}

function IntegrityRow({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "progress" | "neutral";
  icon?: React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 px-3.5 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="inline-flex items-center gap-2 text-sm font-medium">
        {icon ?? <StatusDot tone={tone} />}
        {value}
      </span>
    </li>
  );
}
