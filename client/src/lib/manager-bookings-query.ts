import { auth } from "@/lib/firebase";
import { logger } from "@/lib/logger";
import { tt } from "@/i18n/common-ns";

async function getAuthHeaders(): Promise<HeadersInit> {
  // Use Firebase auth to get fresh token (same as KitchenDashboardOverview)
  const currentFirebaseUser = auth.currentUser;
  if (currentFirebaseUser) {
    try {
      const token = await currentFirebaseUser.getIdToken();
      return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      };
    } catch (error) {
      logger.error('Error getting Firebase token:', error);
    }
  }
  // Fallback to localStorage token if Firebase auth is not available
  const token = localStorage.getItem('firebaseToken');
  if (token) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }
  return {
    'Content-Type': 'application/json',
  };
}

export async function fetchManagerBookings() {
  try {
    const headers = await getAuthHeaders();
    const headersObj = headers as Record<string, string>;
    logger.info('📋 ManagerBookingsPanel: Fetching bookings', {
      hasAuth: !!headersObj.Authorization
    });

    const response = await fetch('/api/manager/bookings', {
      headers,
      credentials: "include",
    });

    logger.info('📋 ManagerBookingsPanel: Response status:', response.status);

    if (!response.ok) {
      let errorMessage = tt("failedToFetchBookings");
      try {
        const errorData = await response.json();
        errorMessage = errorData.message || errorData.error || errorMessage;
        logger.error('❌ ManagerBookingsPanel: Error response:', errorData);
      } catch (jsonError) {
        try {
          const text = await response.text();
          errorMessage = text || `Server returned ${response.status} ${response.statusText}`;
          logger.error('❌ ManagerBookingsPanel: Error text:', text);
        } catch (textError) {
          errorMessage = `Server returned ${response.status} ${response.statusText}`;
        }
      }
      throw new Error(errorMessage);
    }

    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      data = text ? JSON.parse(text) : [];
    }

    logger.info(`✅ ManagerBookingsPanel: Received ${Array.isArray(data) ? data.length : 0} bookings`);
    if (Array.isArray(data) && data.length > 0) {
      logger.info('📋 ManagerBookingsPanel: Sample booking:', data[0]);
    }

    return data;
  } catch (error) {
    logger.error('❌ ManagerBookingsPanel: Fetch error:', error);
    throw error;
  }
}
