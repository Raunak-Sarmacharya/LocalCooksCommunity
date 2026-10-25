export function isChefUser(user?: {
    role?: string | null;
    isChef?: boolean;
} | null): boolean {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'manager') return false;
    return user.role === 'chef' || user.isChef === true;
}

/** True when this chef has not yet been through /chef-setup (welcome, then the path choice). */
export function needsChefOnboarding(user?: {
    role?: string | null;
    isChef?: boolean;
    chefOnboardingCompleted?: boolean;
} | null): boolean {
    return isChefUser(user) && !user?.chefOnboardingCompleted;
}

/** Landing path for chefs after auth and terms: /chef-setup until they choose (or skip), then the dashboard. */
export function getChefPostAuthPath(user?: {
    role?: string | null;
    isChef?: boolean;
    chefOnboardingCompleted?: boolean;
} | null): string {
    if (needsChefOnboarding(user)) {
        return '/chef-setup';
    }
    return '/dashboard';
}
