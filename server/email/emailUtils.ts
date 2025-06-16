// Helper function to extract domain from email or use configured domain
export const getDomainFromEmail = (email: string): string => {
    // First check if EMAIL_DOMAIN is explicitly set
    if (process.env.EMAIL_DOMAIN) {
        return process.env.EMAIL_DOMAIN;
    }

    // Extract from EMAIL_FROM if available
    if (process.env.EMAIL_FROM) {
        const match = process.env.EMAIL_FROM.match(/<([^>]+)>/);
        if (match) {
            const emailPart = match[1];
            const domainMatch = emailPart.match(/@(.+)$/);
            if (domainMatch) {
                return domainMatch[1];
            }
        }
    }

    // Extract from EMAIL_USER as fallback
    const match = email.match(/@(.+)$/);
    if (match) {
        return match[1];
    }

    // Default fallback
    return 'localcooks.community';
};

// Get organization name from environment or default
export const getOrganizationName = (): string => {
    return process.env.EMAIL_ORGANIZATION || 'Local Cooks Community';
};

// Get unsubscribe email from environment or generate from domain
export const getUnsubscribeEmail = (): string => {
    if (process.env.EMAIL_UNSUBSCRIBE) {
        return process.env.EMAIL_UNSUBSCRIBE;
    }

    const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
    return `unsubscribe@${domain}`;
};

// Helper function to get support email based on configured domain
export const getSupportEmail = (): string => {
    const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
    return `support@${domain}`;
};

// Helper function to get the correct website URL based on environment
export const getWebsiteUrl = (): string => {
    // Use environment variable if set, otherwise use the configured domain
    if (process.env.BASE_URL) {
        return process.env.BASE_URL;
    }

    // For production, use the actual domain
    const domain = getDomainFromEmail(process.env.EMAIL_USER || '');
    if (domain && domain !== 'auto-sync.local') {
        return `https://${domain}`;
    }

    // Fallback for development
    return process.env.NODE_ENV === 'production'
        ? 'https://local-cooks-community.vercel.app'
        : 'http://localhost:5000';
};

// Helper function to get the correct dashboard URL
export const getDashboardUrl = (): string => {
    const baseUrl = getWebsiteUrl();
    return `${baseUrl}/auth?redirect=/dashboard`;
};

// Helper function to get privacy policy URL
export const getPrivacyUrl = (): string => {
    const baseUrl = getWebsiteUrl();
    return `${baseUrl}/privacy`;
};

// Helper function to get vendor dashboard URL
export const getVendorDashboardUrl = (): string => {
    return process.env.VENDOR_DASHBOARD_URL || 'https://localcook.shop/app/shop/index.php?redirect=https%3A%2F%2Flocalcook.shop%2Fapp%2Fshop%2Fvendor_onboarding.php';
}; 