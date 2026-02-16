import { logger } from "@/lib/logger";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let errorObj: any;

    try {
      // Try to parse the response as JSON first
      const text = await res.text();
      try {
        errorObj = JSON.parse(text);
      } catch {
        // If parsing fails, use text as is
        errorObj = { message: text || res.statusText };
      }
    } catch (e) {
      // If text() fails, use statusText
      errorObj = { message: res.statusText };
    }

    const error = new Error(`${res.status}: ${errorObj.message || errorObj.error || 'Unknown error'}`);
    (error as any).response = errorObj;
    (error as any).status = res.status;
    throw error;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  customHeaders?: Record<string, string>
): Promise<Response> {
  logger.info(`Making ${method} request to ${url}`, data);

  // SECURITY FIX: Get user ID from current Firebase auth with localStorage fallback
  // This prevents using stale user IDs while maintaining functionality
  const defaultHeaders: Record<string, string> = {};

  try {
    const { auth } = await import('@/lib/firebase');
    const currentUser = auth.currentUser;
    if (currentUser) {
      // Always include Authorization header for backend auto-sync and security
      try {
        const token = await currentUser.getIdToken();
        if (token) {
          defaultHeaders['Authorization'] = `Bearer ${token}`;
        }
      } catch (tokenError) {
        logger.error('Failed to get Firebase token for request:', tokenError);
      }
    }
  } catch (error) {
    logger.error('Error getting current Firebase user:', error);
  }

  const headers: Record<string, string> = {
    ...(data ? { "Content-Type": "application/json" } : {}),
    ...defaultHeaders,
    ...(customHeaders || {})
  };

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  logger.info(`Response from ${url}:`, {
    status: res.status,
    statusText: res.statusText
  });

  // Handle authentication error specifically
  if (res.status === 401) {
    logger.error('Authentication error detected, user is not logged in');
    const error = new Error('Authentication required');
    (error as any).response = { error: 'Authentication required' };
    (error as any).status = 401;
    throw error;
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  headers?: Record<string, string>;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, headers }) =>
    async ({ queryKey }) => {
      // SECURITY FIX: Get user ID from current Firebase auth with localStorage fallback
      // This prevents using stale user IDs while maintaining functionality
      const defaultHeaders: Record<string, string> = {};

      try {
        const { auth } = await import('@/lib/firebase');
        const currentUser = auth.currentUser;
        if (currentUser) {
          try {
            const token = await currentUser.getIdToken();
            if (token) {
              defaultHeaders['Authorization'] = `Bearer ${token}`;
            }
          } catch (tokenError) {
            logger.error('Failed to get Firebase token for query:', tokenError);
          }
        }
        // Removed insecure X-User-ID fallback
      } catch (error) {
        logger.error('Error getting current Firebase user:', error);
      }

      const res = await fetch(queryKey[0] as string, {
        credentials: "include",
        headers: {
          ...defaultHeaders,
          ...(headers || {})
        }
      });

      if (unauthorizedBehavior === "returnNull" && res.status === 401) {
        return null;
      }

      await throwIfResNotOk(res);

      // Get the raw data
      const rawData = await res.json();

      // Check if this is an application endpoint and if the data is an array
      const url = queryKey[0] as string;
      if ((url.includes('/applications') || url.includes('/my-applications')) && Array.isArray(rawData)) {
        // Convert snake_case to camelCase for database fields in application data
        return rawData.map((app: any) => ({
          id: app.id,
          userId: app.user_id || app.userId,
          fullName: app.full_name || app.fullName,
          email: app.email,
          phone: app.phone,
          foodSafetyLicense: app.food_safety_license || app.foodSafetyLicense,
          foodEstablishmentCert: app.food_establishment_cert || app.foodEstablishmentCert,
          kitchenPreference: app.kitchen_preference || app.kitchenPreference,
          feedback: app.feedback,
          status: app.status,
          createdAt: app.created_at || app.createdAt,
          ...(app.applicant_username ? { applicantUsername: app.applicant_username } : {})
        }));
      }

      // Return the raw data for other endpoints
      return rawData;
    };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({
        on401: "throw",
        headers: {} // Empty default headers
      }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
