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
): Promise<Response> {
  console.log(`Making ${method} request to ${url}`, data);
  
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  console.log(`Response from ${url}:`, {
    status: res.status,
    statusText: res.statusText
  });
  
  // Handle authentication error specifically
  if (res.status === 401) {
    console.error('Authentication error detected, user is not logged in');
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
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey[0] as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
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
