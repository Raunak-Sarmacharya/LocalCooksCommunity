import { logger } from "@/lib/logger";
import { mt } from "@/i18n/manager";
import i18n from "@/i18n";
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFirebaseAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { updateProfile } from "firebase/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, KeyRound } from "@/components/ui/manager-icons";
import { StatusButton } from "@/components/ui/status-button";
import { useStatusButton } from "@/hooks/use-status-button";
import ChangePassword from "@/components/auth/ChangePassword";
import PhoneSignInSettings from "@/components/auth/PhoneSignInSettings";
import GoogleSignInSettings from "@/components/auth/GoogleSignInSettings";
import EmailVerificationCard from "@/components/auth/EmailVerificationCard";
import { useEmailSectionFocus } from "@/hooks/use-email-section-focus";
import { isEmailSectionFocused } from "@/lib/email-verification-nav";
import {
    ContactInfoCard,
    ContactStatusPill,
    ContactVerificationRow,
    PRIMARY_ROW_ACTION,
    QUIET_ROW_ACTION,
    type ContactTone,
} from "@/components/profile/ContactVerificationRow";
import { PHONE_AUTH_ENABLED } from "@/lib/feature-flags";
import { SettingsRow } from "@/components/manager/settings/SettingsRow";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import StripeConnectSetup from "@/components/manager/StripeConnectSetup";
import NotificationsSettings from "@/components/manager/settings/NotificationsSettings";
import LocationSettings from "@/components/manager/settings/LocationSettings";

interface ManagerProfileSettingsProps {
    location?: {
        id: number;
        name: string;
        address: string;
        logoUrl?: string;
        timezone?: string;
    } | null;
    onSaveLocationSettings?: (updates: any) => Promise<unknown>;
    notificationLocation?: {
        id: number;
        name: string;
        notificationEmail?: string;
    } | null;
    onSaveNotificationSettings?: (updates: any) => Promise<unknown>;
}

/**
 * Every tab value this page understands.
 *
 * `account` is NOT free to rename: `emailVerificationHref()` builds
 * `/manager/dashboard?view=profile&focus=email&tab=account` and
 * `email-verification-nav.test.ts` asserts that string. It is the tab that holds
 * the email card, so the value stays even though the label is now "Sign-in & security".
 */
const KNOWN_TABS = ["profile", "account", "location", "payments", "notifications", "teams"] as const;

const CARD = "overflow-hidden rounded-[1.35rem] border bg-card";

/**
 * Row-action hierarchy lives in `ContactVerificationRow` as `PRIMARY_ROW_ACTION` /
 * `QUIET_ROW_ACTION` / `DANGER_ROW_ACTION`, so every row on the page ranks its actions
 * the same way instead of each file guessing.
 */

function CardHead({ title, description }: { title: string; description: string }) {
    return (
        <div className="border-b px-5 py-4">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
        </div>
    );
}

/**
 * The Location and Notifications tabs both need a location to edit. When the manager
 * has none — they have not finished onboarding — the old copy was a dead end that
 * told them to "Select a Location" with nothing to select. This offers the one action
 * that actually resolves the state.
 */
function NoKitchenYet() {
    const [, setLocation] = useLocation();
    return (
        <div className="rounded-[1.35rem] border border-dashed bg-card p-10 text-center">
            <h3 className="font-semibold text-foreground">{mt("noKitchenTitle")}</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{mt("noKitchenDesc")}</p>
            <Button className="mt-5" onClick={() => setLocation("/manager/setup")}>
                {mt("addYourKitchen")}
            </Button>
        </div>
    );
}

export default function ManagerProfileSettings({
    location,
    onSaveLocationSettings,
    notificationLocation,
    onSaveNotificationSettings,
}: ManagerProfileSettingsProps = {}) {

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const { user: firebaseUser, refreshUserData } = useFirebaseAuth();
    const emailSectionHighlighted = useEmailSectionFocus();

    const [phone, setPhone] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [savedDisplayName, setSavedDisplayName] = useState("");
    // The password form is revealed on request rather than sitting open — it is an
    // optional SECOND way in, so it should read as an offer, not as an unfinished form.
    const [isEditingPassword, setIsEditingPassword] = useState(false);
    const [activeTab, setActiveTab] = useState(() => {
        // A deep link to the email section wins over any remembered tab, otherwise
        // "verify your email" could land the manager on Payments with no card in sight.
        if (isEmailSectionFocused()) return "account";
        const params = new URLSearchParams(window.location.search);
        const legacyView = params.get("view");
        if (legacyView === "payments") return "payments";
        if (legacyView === "notification-settings") return "notifications";
        const tab = params.get("tab");
        // "password" was a tab of its own before security was grouped under one roof.
        if (tab === "password") return "account";
        return tab && (KNOWN_TABS as readonly string[]).includes(tab) ? tab : "profile";
    });

    // Fetch manager profile
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
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    if (response.status === 401) {
                        return null;
                    }
                    throw new Error(`Failed to fetch profile: ${response.status}`);
                }

                const userData = await response.json();
                return userData;
            } catch (error) {
                logger.error('Error fetching user profile:', error);
                return null;
            }
        },
        enabled: !!firebaseUser,
    });

    // Fetch manager profile details
    const { data: managerProfile, isLoading: isLoadingDetails } = useQuery({
        queryKey: ["/api/manager/profile"],
        queryFn: async () => {
            try {
                const currentFirebaseUser = auth.currentUser;
                if (!currentFirebaseUser) return null;
                const token = await currentFirebaseUser.getIdToken();
                const response = await fetch("/api/manager/profile", {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    credentials: 'include',
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return { phone: null, displayName: null, stripeConnectStatus: 'not_started', locations: [] };
                    }
                    throw new Error(`Failed to fetch manager profile: ${response.status}`);
                }

                return response.json();
            } catch (error) {
                return { phone: null, displayName: null, stripeConnectStatus: 'not_started', locations: [] };
            }
        },
        enabled: !!user && user.role === 'manager',
    });

    // Initialize form fields.
    //
    // displayName priority: Firebase Auth > managerProfile > user record.
    // `savedDisplayName` is the baseline the Save button compares against, so it is
    // set from the same resolved value rather than re-derived later.
    useEffect(() => {
        const resolved =
            auth.currentUser?.displayName ||
            managerProfile?.displayName ||
            user?.displayName ||
            user?.fullName ||
            "";
        setDisplayName(resolved);
        setSavedDisplayName(resolved);

        // `users.phone_number` is the source of truth for a number that is on the
        // ACCOUNT, and `managerProfileData.phone` is only written by the verified save
        // flow — so a number that was stored but never linked to Firebase lives ONLY
        // on the user row. Falling back to it is what keeps the phone row from
        // reporting "No phone number added" for a number the manager can see in their
        // own account. (The retired `/manager/profile` page had this fallback; this
        // surface — the one managers actually use — did not.)
        if (managerProfile || user) {
            setPhone(managerProfile?.phone || user?.phoneNumber || "");
        }
    }, [user, managerProfile, firebaseUser]);

    // Update profile mutation
    const updateProfileMutation = useMutation({
        mutationFn: async (profileData: {
            displayName?: string;
            phone?: string;
        }) => {
            const currentFirebaseUser = auth.currentUser;
            if (!currentFirebaseUser) throw new Error(mt("notAuthenticated"));

            // IMPORTANT: Update Firebase Auth displayName if it changed
            if (profileData.displayName) {
                try {
                    await updateProfile(currentFirebaseUser, {
                        displayName: profileData.displayName,
                    });
                    logger.info('✅ Firebase Auth displayName updated:', profileData.displayName);
                } catch (firebaseError) {
                    logger.error('❌ Failed to update Firebase Auth displayName:', firebaseError);
                    // Continue with Neon update even if Firebase update fails
                }
            }

            const token = await currentFirebaseUser.getIdToken();
            const response = await fetch("/api/manager/profile", {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify(profileData),
            });

            if (!response.ok) throw new Error(mt("failedToUpdateProfile"));
            return response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/manager/profile"] });
            queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
            void refreshUserData();
            toast({ title: mt("profileUpdated"),
                description: mt("yourChangesHaveBeenSavedSuccessfully"),
            });
        },
        onError: (error: any) => {
            toast({ title: mt("updateFailed2"),
                description: error.message || "Failed to update profile",
                variant: "destructive",
            });
        },
    });

    const saveProfileAction = useStatusButton(
        useCallback(async () => {
            await updateProfileMutation.mutateAsync({ displayName: displayName.trim() });
        }, [updateProfileMutation, displayName]),
    );

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        const url = new URL(window.location.href);
        if (tab === "profile") url.searchParams.delete("tab");
        else url.searchParams.set("tab", tab);
        window.history.replaceState({}, "", url);
    };

    const isProfileDirty = displayName.trim() !== savedDisplayName.trim();

    // `passwordSetByUser` is the database record, not the form's own guess at which
    // mode to show — so the pill cannot disagree with whether a password really exists.
    const passwordSet = user?.passwordSetByUser === true;
    const passwordTone: ContactTone = passwordSet ? "verified" : "empty";

    const closePasswordForm = () => {
        setIsEditingPassword(false);
        // Setting a password does not invalidate this page's queries, so re-read the
        // record when the form closes or the pill would still say "Not set".
        queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
    };

    const memberSince = (() => {
        const createdAt = user?.createdAt;
        if (!createdAt) return null;
        const date = new Date(createdAt);
        if (Number.isNaN(date.getTime())) return null;
        return mt("memberSince", {
            date: new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(date),
        });
    })();

    if (isLoadingProfile || isLoadingDetails) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
                    <p className="text-sm text-muted-foreground">{mt("loadingYourProfile")}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative mx-auto max-w-4xl space-y-6 pb-10">
            {/* Page Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">{mt("cmdProfileSettings")}</h1>
                <p className="text-muted-foreground mt-1">{mt("manageYourAccountDetailsAndSecurityPreferences")}</p>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="h-auto w-full justify-start gap-0 overflow-x-auto rounded-none border-b bg-transparent p-0">
                    {[
                        ["profile", mt("shellProfile")],
                        ["account", mt("tabSignInSecurity")],
                        ["location", mt("navLocation")],
                        ["payments", mt("paymentsPayouts")],
                        ["notifications", mt("notificationSettings")],
                        ["teams", mt("navTeams")],
                    ].map(([value, label]) => (
                        <TabsTrigger
                            key={value}
                            value={value}
                            className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                        >
                            {label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                {/* ── Profile: who you are, and how the app speaks to you ──────── */}
                <TabsContent value="profile" className="mt-6 focus-visible:ring-0">
                    <div className={CARD}>
                        <CardHead title={mt("shellProfile")} description={mt("profileSectionDesc")} />

                        {/* `SettingsRow` owns the label/hint/control layout, and the card's
                            own `divide-y` separates the rows — so this card needs no
                            per-field headings and no body padding. */}
                        <div className="divide-y divide-border">
                            <SettingsRow
                                id="displayName"
                                label={mt("displayName")}
                                hint={mt("yourNameAsItAppearsToOthers")}
                                layout="stacked"
                            >
                                <Input
                                    id="displayName"
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={mt("johnDoe")}
                                    className="h-11 max-w-md"
                                />
                            </SettingsRow>

                            <SettingsRow label={mt("language")} hint={mt("languageHint")}>
                                <LanguageSwitcher size="sm" />
                            </SettingsRow>
                        </div>

                        {/* One save control per card, and it only appears once there is
                            something to save — the old page mixed a global Edit toggle
                            with always-live sections, which is what made it read as
                            having edit buttons everywhere. */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4">
                            <p className="text-xs text-muted-foreground">{memberSince}</p>
                            {(isProfileDirty || saveProfileAction.status !== "idle") && (
                                <StatusButton
                                    status={saveProfileAction.status}
                                    onClick={saveProfileAction.execute}
                                    disabled={!isProfileDirty || !displayName.trim()}
                                    labels={{ idle: mt("saveChanges"), loading: mt("saving"), success: mt("saved") }}
                                />
                            )}
                        </div>
                    </div>
                </TabsContent>

                {/* ── Sign-in & security: every way into the account ───────────── */}
                <TabsContent value="account" className="mt-6 focus-visible:ring-0">
                    <div className={CARD}>
                        <CardHead title={mt("signInMethods")} description={mt("signInSecurityDesc")} />
                        <ContactInfoCard className="rounded-none border-0">
                            <EmailVerificationCard
                                embedded
                                highlighted={emailSectionHighlighted}
                                onVerified={() => {
                                    // Non-forcing: background refresh, and an email change
                                    // invalidates the token a forced refresh would use.
                                    void refreshUserData({ forceToken: false });
                                    queryClient.invalidateQueries({ queryKey: ["/api/user/profile", firebaseUser?.uid] });
                                }}
                            />
                            {PHONE_AUTH_ENABLED && (
                                <PhoneSignInSettings
                                    embedded
                                    initialPhone={phone}
                                    onPhoneLinked={async (verifiedPhone) => {
                                        try {
                                            await updateProfileMutation.mutateAsync({ phone: verifiedPhone });
                                        } catch {}
                                    }}
                                    onPhoneUnlinked={async () => {
                                        try {
                                            await updateProfileMutation.mutateAsync({ phone: "" });
                                        } catch {}
                                    }}
                                />
                            )}
                            {/* Whether Google could be used before this depended on the user's
                                email DOMAIN — Firebase links accounts itself only when both
                                sides are "trusted", and Google counts as trusted only for
                                `@gmail.com`. So this makes a real capability deliberate. */}
                            <GoogleSignInSettings />

                            {/* The password is a sign-in method like the other three, so it is
                                a row in the same list rather than a card of its own. The form
                                stays closed until asked for: it is an OPTION to add a second
                                way in, and two empty fields on arrival read as an unfinished
                                task. */}
                            <ContactVerificationRow
                                id="security-password"
                                labelId="security-password-label"
                                icon={<KeyRound className="size-4" />}
                                label={mt("security")}
                                tone={passwordTone}
                                badges={
                                    <ContactStatusPill tone={passwordTone}>
                                        {passwordSet ? mt("passwordSet") : mt("passwordNotSet")}
                                    </ContactStatusPill>
                                }
                                help={mt("passwordSectionDesc")}
                                actions={
                                    isEditingPassword ? undefined : (
                                        // Not having a password is the row's outstanding
                                        // state, so SETTING one is the primary. Changing an
                                        // existing one is routine, so it drops to quiet.
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={passwordSet ? "ghost" : "default"}
                                            className={passwordSet ? QUIET_ROW_ACTION : PRIMARY_ROW_ACTION}
                                            onClick={() => setIsEditingPassword(true)}
                                        >
                                            {passwordSet ? mt("changePassword") : mt("setPassword")}
                                        </Button>
                                    )
                                }
                            >
                                {isEditingPassword ? (
                                    <div className="max-w-md rounded-xl border bg-background p-4">
                                        <ChangePassword
                                            role="manager"
                                            embedded
                                            // Closing on success is the point of the panel: it is an
                                            // OPTION to add a second way in, so once the password is
                                            // saved there is nothing left to do inside it. Leaving it
                                            // open made the visitor hunt for `Cancel` to dismiss a
                                            // form that had already finished.
                                            onSuccess={closePasswordForm}
                                            // `Cancel` is handed in rather than rendered here: the form
                                            // owns the submit, so only it can put the two on one line.
                                            // The label stays localised by this page.
                                            onCancel={closePasswordForm}
                                            cancelLabel={mt("cancel")}
                                        />
                                    </div>
                                ) : null}
                            </ContactVerificationRow>
                        </ContactInfoCard>
                    </div>
                </TabsContent>

                {/* ── Location ─────────────────────────────────────────────────── */}
                <TabsContent value="location" className="mt-6 focus-visible:ring-0">
                    {location && onSaveLocationSettings ? (
                        <LocationSettings location={location} onSave={onSaveLocationSettings} embedded />
                    ) : (
                        <NoKitchenYet />
                    )}
                </TabsContent>

                {/* ── Payments ─────────────────────────────────────────────────── */}
                <TabsContent value="payments" className="mt-6 focus-visible:ring-0">
                    {/* The onboarding wizard already wraps this in a Card
                        (`PaymentSetupStep`); this tab rendered it bare, which is why
                        Payments looked unlike every other tab on the page. The component
                        supplies its own state-dependent heading, so there is no CardHead. */}
                    <div className={`${CARD} p-5`}>
                        <StripeConnectSetup />
                    </div>
                </TabsContent>

                {/* ── Notifications ────────────────────────────────────────────── */}
                <TabsContent value="notifications" className="mt-6 focus-visible:ring-0">
                    {notificationLocation && onSaveNotificationSettings ? (
                        <NotificationsSettings
                            location={notificationLocation}
                            onSave={onSaveNotificationSettings}
                            embedded
                        />
                    ) : (
                        <NoKitchenYet />
                    )}
                </TabsContent>

                {/* ── Teams (placeholder) ──────────────────────────────────────── */}
                <TabsContent value="teams" className="mt-6 focus-visible:ring-0">
                    <div className="space-y-4 rounded-[1.35rem] border border-dashed bg-card p-10 text-center">
                        <div>
                            <h3 className="text-lg font-semibold text-foreground">{mt("teamsComingSoon")}</h3>
                            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                                {mt("teamsComingSoonDesc")}
                            </p>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}
