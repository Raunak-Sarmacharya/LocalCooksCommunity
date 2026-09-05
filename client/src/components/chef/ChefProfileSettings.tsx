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
  Mail,
  Phone,
  KeyRound,
  Shield,
  Camera,
  CheckCircle2,
  Edit3,
  Lock,
  X,
} from "lucide-react";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import ChangePassword from "@/components/auth/ChangePassword";
import { useFileUpload } from "@/hooks/useFileUpload";
import { useTranslation } from "react-i18next";
import { tt } from "@/i18n/common-ns";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { motion, AnimatePresence } from "framer-motion";
import { ChefPageHeader, StatusDot } from "@/components/chef/ui";

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
  const [isEditingProfile, setIsEditingProfile] = useState(false);

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
        return {
          label: t("profileStatusNotApplied", "Not Applied"),
          tone: "neutral" as const,
        };
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/chef/my-profile"] });
      queryClient.invalidateQueries({
        queryKey: ["/api/user/profile", firebaseUser?.uid],
      });
      setIsEditingProfile(false);
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

  const saveProfileAction = useStatusButton(
    useCallback(async () => {
      await updateProfileMutation.mutateAsync({
        username: username !== user?.username ? username : undefined,
        displayName: displayName || undefined,
        phone: phone || undefined,
      });
    }, [updateProfileMutation, username, user?.username, displayName, phone])
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
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-44 animate-pulse rounded-2xl bg-muted" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-2xl bg-muted lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        </div>
      </div>
    );
  }

  const appStatus = getApplicationStatusDisplay(chefProfile?.applicationStatus);
  const photoSrc = avatarUrl || firebaseUser?.photoURL || undefined;

  return (
    <div className="relative mx-auto max-w-4xl space-y-8 pb-16">
      {/* Soft brand wash — same language as site chrome */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[-1rem] -top-4 -z-10 h-72 rounded-[2rem] bg-[radial-gradient(ellipse_at_28%_20%,hsl(348_85%_59%_/_0.1),transparent_58%)]"
      />

      <ChefPageHeader
        title={t("profileTitle", "Profile Settings")}
        description={t(
          "profileDescription",
          "Manage your account details and security preferences"
        )}
        actions={
          <Button
            type="button"
            size="sm"
            variant={isEditingProfile ? "secondary" : "outline"}
            onClick={() => setIsEditingProfile((v) => !v)}
          >
            {isEditingProfile ? (
              <>
                <X className="mr-1.5 h-3.5 w-3.5" />
                {t("profileCancel", "Cancel")}
              </>
            ) : (
              <>
                <Edit3 className="mr-1.5 h-3.5 w-3.5" />
                {t("profileEditProfile", "Edit Profile")}
              </>
            )}
          </Button>
        }
      />

      {/* Light identity hero */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl border bg-card"
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
            <p className="mt-1 truncate text-sm text-muted-foreground">{email}</p>

            <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground sm:justify-start">
              <li className="inline-flex items-center gap-2">
                <StatusDot tone="progress" className="bg-primary" />
                <span>{t("profileChefBadge", "Chef")}</span>
              </li>
              <li className="hidden h-3 w-px bg-border sm:block" aria-hidden />
              <li className="inline-flex items-center gap-2">
                <StatusDot tone={user?.isVerified ? "success" : "warning"} />
                <span>
                  {user?.isVerified
                    ? t("profileVerifiedBadge", "Verified")
                    : t("pfPending", "Pending")}
                </span>
              </li>
              <li className="hidden h-3 w-px bg-border sm:block" aria-hidden />
              <li className="inline-flex items-center gap-2">
                <StatusDot tone={appStatus.tone} />
                <span>{appStatus.label}</span>
              </li>
            </ul>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Personal info — main column */}
        <motion.section
          className="lg:col-span-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06 }}
        >
          <Section
            title={t("profilePersonalInformation", "Personal Information")}
            description={t(
              "profilePublicProfileDetails",
              "Your public profile details"
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {isEditingProfile ? (
                <motion.div
                  key="edit"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <FieldGroup className="gap-5">
                    <Field>
                      <FieldLabel htmlFor="displayName">
                        {t("profileDisplayName", "Display Name")}
                      </FieldLabel>
                      <Input
                        id="displayName"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={t("profileDisplayNamePlaceholder", "John Doe")}
                        className="h-11"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="username">
                        {t("profileUsername", "Username")}
                      </FieldLabel>
                      <Input
                        id="username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder={t("profileUsernamePlaceholder", "johndoe")}
                        className="h-11"
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="phone">
                        {t("profilePhoneNumber", "Phone Number")}
                      </FieldLabel>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder={t(
                            "profilePhonePlaceholder",
                            "+1 (555) 000-0000"
                          )}
                          className="h-11 pl-10"
                        />
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="email">
                        {t("profileEmailAddress", "Email Address")}
                      </FieldLabel>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          id="email"
                          type="email"
                          value={email}
                          disabled
                          className="h-11 bg-muted pl-10 pr-10"
                        />
                        <Lock className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
                      </div>
                      <FieldDescription className="flex items-center gap-1.5">
                        <Shield className="h-3 w-3" />
                        {t(
                          "profileEmailLinkedNotice",
                          "Email is linked to your authentication and cannot be changed here"
                        )}
                      </FieldDescription>
                    </Field>
                  </FieldGroup>
                  <div className="mt-6 flex justify-end border-t pt-5">
                    <StatusButton
                      status={saveProfileAction.status}
                      onClick={saveProfileAction.execute}
                      labels={{
                        idle: t("profileSaveChanges", "Save Changes"),
                        loading: t("profileSaving", "Saving"),
                        success: t("profileSaved", "Saved"),
                      }}
                    />
                  </div>
                </motion.div>
              ) : (
                <motion.dl
                  key="view"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="grid gap-4 sm:grid-cols-2"
                >
                  <InfoTile
                    label={t("profileDisplayName", "Display Name")}
                    value={displayName || "—"}
                  />
                  <InfoTile
                    label={t("profileUsername", "Username")}
                    value={username || "—"}
                  />
                  <InfoTile
                    label={t("profilePhoneNumber", "Phone Number")}
                    value={phone || "—"}
                    icon={<Phone className="h-3.5 w-3.5" />}
                  />
                  <InfoTile
                    label={t("profileEmailAddress", "Email Address")}
                    value={email || "—"}
                    icon={<Mail className="h-3.5 w-3.5" />}
                  />
                </motion.dl>
              )}
            </AnimatePresence>
          </Section>
        </motion.section>

        {/* Sidebar */}
        <motion.div
          className="space-y-6"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Section title={t("pfAccountStatus")}>
            <ul className="space-y-3">
              <IntegrityRow
                label={t("pfAccountType")}
                value={t("pfRoleChef")}
                tone="progress"
              />
              <IntegrityRow
                label={t("pfEmailVerified")}
                value={user?.isVerified ? t("pfYes") : t("pfPending", "Pending")}
                tone={user?.isVerified ? "success" : "warning"}
                icon={
                  user?.isVerified ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : undefined
                }
              />
              <IntegrityRow
                label={t("pfApplication")}
                value={appStatus.label}
                tone={appStatus.tone}
              />
            </ul>
          </Section>
        </motion.div>

        {/* Security — full width, same section language, no nested card */}
        <motion.section
          className="lg:col-span-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
        >
          <Section
            title={t("pfSecurityTitle")}
            description={t("pfSecurityDesc")}
            icon={<KeyRound className="h-4 w-4 text-primary" />}
          >
            <ChangePassword role="chef" embedded />
          </Section>
        </motion.section>
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
    <div className="rounded-2xl border bg-card">
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

function InfoTile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
        {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        <span className="min-w-0 break-words">{value}</span>
      </p>
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
