import { auth } from './firebase';

export class APIClient {
  private baseURL: string;

  constructor(baseURL: string = '/api') {
    this.baseURL = baseURL;
  }

  /**
   * Get Firebase Auth token for API requests
   */
  private async getAuthToken(): Promise<string | null> {
    try {
      if (!auth.currentUser) {
        return null;
      }
      
      const token = await auth.currentUser.getIdToken();
      return token;
    } catch (error) {
      console.error('Error getting Firebase auth token:', error);
      return null;
    }
  }

  /**
   * Make authenticated API request
   */
  private async makeRequest(
    endpoint: string, 
    options: RequestInit = {},
    requireAuth: boolean = true
  ): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    
    // Set up headers
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add Firebase auth token if required
    if (requireAuth) {
      const token = await this.getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (requireAuth) {
        throw new Error('Authentication required but no token available');
      }
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    return response;
  }

  /**
   * GET request with auth
   */
  async get(endpoint: string, requireAuth: boolean = true): Promise<Response> {
    return this.makeRequest(endpoint, { method: 'GET' }, requireAuth);
  }

  /**
   * POST request with auth
   */
  async post(endpoint: string, data: any = null, requireAuth: boolean = true): Promise<Response> {
    return this.makeRequest(
      endpoint, 
      { 
        method: 'POST', 
        body: data ? JSON.stringify(data) : undefined 
      }, 
      requireAuth
    );
  }

  /**
   * PUT request with auth
   */
  async put(endpoint: string, data: any = null, requireAuth: boolean = true): Promise<Response> {
    return this.makeRequest(
      endpoint, 
      { 
        method: 'PUT', 
        body: data ? JSON.stringify(data) : undefined 
      }, 
      requireAuth
    );
  }

  /**
   * DELETE request with auth
   */
  async delete(endpoint: string, requireAuth: boolean = true): Promise<Response> {
    return this.makeRequest(endpoint, { method: 'DELETE' }, requireAuth);
  }

  /**
   * POST form data (for file uploads)
   */
  async postFormData(endpoint: string, formData: FormData, requireAuth: boolean = true): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`;
    
    const headers: HeadersInit = {};

    // Add Firebase auth token if required
    if (requireAuth) {
      const token = await this.getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else if (requireAuth) {
        throw new Error('Authentication required but no token available');
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    return response;
  }
}

// Create default API client instance
export const apiClient = new APIClient();

// Helper functions for common operations
export async function apiGet(endpoint: string, requireAuth: boolean = true) {
  const response = await apiClient.get(endpoint, requireAuth);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function apiPost(endpoint: string, data: any = null, requireAuth: boolean = true) {
  const response = await apiClient.post(endpoint, data, requireAuth);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function apiPut(endpoint: string, data: any = null, requireAuth: boolean = true) {
  const response = await apiClient.put(endpoint, data, requireAuth);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function apiDelete(endpoint: string, requireAuth: boolean = true) {
  const response = await apiClient.delete(endpoint, requireAuth);
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
} 