/**
 * Always Food Safe API Integration
 * 
 * This module provides integration with Always Food Safe's API for
 * submitting completion data and managing certifications.
 * 
 * Based on Always Food Safe's LMS integration capabilities:
 * - SCORM compliant training modules
 * - API integration for completion tracking
 * - Certificate generation and management
 */


interface AlwaysFoodSafeSubmission {
  userId: number;
  userName: string;
  email: string;
  completionDate: Date;
  videoProgress: any[];
}

interface AlwaysFoodSafeResponse {
  success: boolean;
  certificateId?: string;
  certificateUrl?: string;
  message?: string;
  error?: string;
}

/**
 * Submit completion data to Always Food Safe API
 * This would integrate with their LMS API to record completion
 */
export async function submitToAlwaysFoodSafe(
  submission: AlwaysFoodSafeSubmission
): Promise<AlwaysFoodSafeResponse> {
  const apiKey = process.env.ALWAYS_FOOD_SAFE_API_KEY;
  const apiUrl = process.env.ALWAYS_FOOD_SAFE_API_URL || 'https://api.alwaysfoodsafe.com';

  if (!apiKey) {
    throw new Error('Always Food Safe API key not configured');
  }

  try {
    // This is a placeholder implementation
    // In a real implementation, you would:
    // 1. Format the data according to Always Food Safe's API specification
    // 2. Submit to their completion endpoint
    // 3. Handle their response format
    
    const response = await fetch(`${apiUrl}/api/v1/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'LocalCooks-Platform/1.0'
      },
      body: JSON.stringify({
        user: {
          id: submission.userId,
          name: submission.userName,
          email: submission.email
        },
        completion: {
          date: submission.completionDate.toISOString(),
          modules: submission.videoProgress.map(video => ({
            id: video.videoId,
            completed: video.completed,
            progress: video.progress,
            completedAt: video.completedAt
          }))
        },
        course: {
          type: 'microlearning',
          provider: 'LocalCooks',
          modules: ['food-handling', 'contamination-prevention', 'allergen-awareness']
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Always Food Safe API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      certificateId: data.certificate?.id,
      certificateUrl: data.certificate?.url,
      message: data.message || 'Completion submitted successfully'
    };

  } catch (error) {
    console.error('Always Food Safe API submission failed:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
}

/**
 * Verify a certificate with Always Food Safe
 */
export async function verifyCertificate(certificateId: string): Promise<boolean> {
  const apiKey = process.env.ALWAYS_FOOD_SAFE_API_KEY;
  const apiUrl = process.env.ALWAYS_FOOD_SAFE_API_URL || 'https://api.alwaysfoodsafe.com';

  if (!apiKey) {
    return false;
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/certificates/${certificateId}/verify`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'LocalCooks-Platform/1.0'
      }
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.valid === true;

  } catch (error) {
    console.error('Certificate verification failed:', error);
    return false;
  }
}

/**
 * Get available training modules from Always Food Safe
 */
export async function getTrainingModules(): Promise<any[]> {
  const apiKey = process.env.ALWAYS_FOOD_SAFE_API_KEY;
  const apiUrl = process.env.ALWAYS_FOOD_SAFE_API_URL || 'https://api.alwaysfoodsafe.com';

  if (!apiKey) {
    return [];
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/modules`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'User-Agent': 'LocalCooks-Platform/1.0'
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.modules || [];

  } catch (error) {
    console.error('Failed to fetch training modules:', error);
    return [];
  }
}

/**
 * Configuration check for Always Food Safe integration
 */
export function isAlwaysFoodSafeConfigured(): boolean {
  return !!(process.env.ALWAYS_FOOD_SAFE_API_KEY && process.env.ALWAYS_FOOD_SAFE_API_URL);
}

/**
 * Get integration status and configuration
 */
export function getIntegrationStatus() {
  return {
    configured: isAlwaysFoodSafeConfigured(),
    apiUrl: process.env.ALWAYS_FOOD_SAFE_API_URL || 'https://api.alwaysfoodsafe.com',
    hasApiKey: !!process.env.ALWAYS_FOOD_SAFE_API_KEY
  };
} 