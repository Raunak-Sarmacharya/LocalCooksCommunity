import { Request, Response, Router } from "express";
import { storage } from "../storage";
import { generateCertificatePDF } from "../certificate-utils";
import { upload } from "../fileUpload";
import { pool } from "../db";
// @ts-ignore
import { isAlwaysFoodSafeConfigured, submitToAlwaysFoodSafe } from "../alwaysFoodSafeAPI";

const router = Router();

// Helper
const hasApprovedApplication = async (userId: number) => {
  try {
    const applications = await storage.getApplicationsByUserId(userId);
    return applications.some(app => app.status === 'approved');
  } catch (error) {
    console.error('Error checking application status:', error);
    return false;
  }
};

// Get user's microlearning access level and progress
router.get("/progress/:userId", async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userId = parseInt(req.params.userId);

    // Verify user can access this data (either their own or admin)
    if (req.user!.id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const progress = await storage.getMicrolearningProgress(userId);
    const completionStatus = await storage.getMicrolearningCompletion(userId);
    const hasApproval = await hasApprovedApplication(userId);

    // Admins and completed users have unrestricted access regardless of application status
    const isAdmin = req.user!.role === 'admin';
    const isCompleted = completionStatus?.confirmed || false;
    const accessLevel = isAdmin || hasApproval || isCompleted ? 'full' : 'limited';

    res.json({
      success: true,
      progress: progress || [],
      completionConfirmed: completionStatus?.confirmed || false,
      completedAt: completionStatus?.completedAt,
      hasApprovedApplication: hasApproval,
      accessLevel: accessLevel, // admins get full access, others limited to first video only
      isAdmin: isAdmin
    });
  } catch (error) {
    console.error('Error fetching microlearning progress:', error);
    res.status(500).json({ message: 'Failed to fetch progress' });
  }
});

// Update video progress
router.post("/progress", async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { userId, videoId, progress, completed, completedAt, watchedPercentage } = req.body;

    // Verify user can update this data (either their own or admin)
    if (req.user!.id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has approved application for videos beyond the first one
    const hasApproval = await hasApprovedApplication(userId);
    const completionStatus = await storage.getMicrolearningCompletion(userId);
    const isCompleted = completionStatus?.confirmed || false;
    const firstVideoId = 'basics-cross-contamination'; // First video that everyone can access
    const isAdmin = req.user!.role === 'admin';

    // Admins and completed users have unrestricted access to all videos
    if (!hasApproval && !isAdmin && !isCompleted && videoId !== firstVideoId) {
      return res.status(403).json({
        message: 'Application approval required to access this video',
        accessLevel: 'limited',
        firstVideoOnly: true
      });
    }

    // Accept completion status as provided
    const actualCompleted = completed;

    const progressData = {
      userId,
      videoId,
      progress: Math.max(0, Math.min(100, progress)), // Clamp between 0-100
      watchedPercentage: Math.max(0, Math.min(100, watchedPercentage || 0)), // Clamp between 0-100
      completed: actualCompleted,
      completedAt: actualCompleted ? (completedAt ? new Date(completedAt) : new Date()) : null,
      updatedAt: new Date()
    };

    await storage.updateVideoProgress(progressData);

    res.json({
      success: true,
      message: 'Progress updated successfully'
    });
  } catch (error) {
    console.error('Error updating video progress:', error);
    res.status(500).json({ message: 'Failed to update progress' });
  }
});

// Complete microlearning and integrate with Always Food Safe
router.post("/complete", async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { userId, completionDate, videoProgress } = req.body;

    // Verify user can complete this (either their own or admin)
    if (req.user!.id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if user has approved application to complete full training
    const hasApproval = await hasApprovedApplication(userId);
    const isAdmin = req.user!.role === 'admin';

    // Admins can complete certification without application approval
    // Regular users need approval unless they're completing as admin
    if (!hasApproval && !isAdmin) {
      return res.status(403).json({
        message: 'Application approval required to complete full certification',
        accessLevel: 'limited',
        requiresApproval: true
      });
    }

    // Verify all required videos are completed (2 comprehensive modules)
    const requiredVideos = [
      // Food Safety Basics Module (14 videos)
      'basics-personal-hygiene', 'basics-temperature-danger', 'basics-cross-contamination',
      'basics-allergen-awareness', 'basics-food-storage', 'basics-cooking-temps',
      'basics-cooling-reheating', 'basics-thawing', 'basics-receiving', 'basics-fifo',
      'basics-illness-reporting', 'basics-pest-control', 'basics-chemical-safety', 'basics-food-safety-plan',
      // Safety and Hygiene How-To's Module (8 videos)
      'howto-handwashing', 'howto-sanitizing', 'howto-thermometer', 'howto-cleaning-schedule',
      'howto-equipment-cleaning', 'howto-uniform-care', 'howto-wound-care', 'howto-inspection-prep'
    ];
    const completedVideos = videoProgress.filter((v: any) => v.completed).map((v: any) => v.videoId);
    const allRequired = requiredVideos.every((videoId: string) => completedVideos.includes(videoId));

    if (!allRequired) {
      return res.status(400).json({
        message: 'All required videos must be completed before certification',
        missingVideos: requiredVideos.filter(id => !completedVideos.includes(id))
      });
    }

    // Get user details for certificate generation
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Create completion record
    const completionData = {
      userId,
      completedAt: new Date(completionDate),
      videoProgress,
      confirmed: true,
      certificateGenerated: false
    };

    await storage.createMicrolearningCompletion(completionData);

    // Integration with Always Food Safe API (if configured)
    let alwaysFoodSafeResult = null;
    if (isAlwaysFoodSafeConfigured()) {
      try {
        alwaysFoodSafeResult = await submitToAlwaysFoodSafe({
          userId,
          userName: user.username,
          email: `${user.username}@localcooks.ca`, // Placeholder email since User type doesn't have email
          completionDate: new Date(completionDate),
          videoProgress
        });
      } catch (afsError) {
        console.error('Always Food Safe API error:', afsError);
        // Don't fail the request, just log the error
      }
    }

    res.json({
      success: true,
      message: 'Microlearning completed successfully',
      completionConfirmed: true,
      alwaysFoodSafeIntegration: alwaysFoodSafeResult?.success ? 'success' : 'not_configured',
      certificateId: alwaysFoodSafeResult?.certificateId,
      certificateUrl: alwaysFoodSafeResult?.certificateUrl
    });
  } catch (error) {
    console.error('Error completing microlearning:', error);
    res.status(500).json({ message: 'Failed to complete microlearning' });
  }
});

// Get microlearning completion status
router.get("/completion/:userId", async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userId = parseInt(req.params.userId);

    // Verify user can access this completion (either their own or admin)
    if (req.user!.id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await storage.getMicrolearningCompletion(userId);

    if (!completion) {
      return res.status(404).json({ message: 'No completion found' });
    }

    res.json(completion);
  } catch (error) {
    console.error('Error getting microlearning completion status:', error);
    res.status(500).json({ message: 'Failed to get completion status' });
  }
});

// Generate and download certificate
router.get("/certificate/:userId", async (req: Request, res: Response) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userId = parseInt(req.params.userId);

    // Verify user can access this certificate (either their own or admin)
    if (req.user!.id !== userId && req.user!.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    const completion = await storage.getMicrolearningCompletion(userId);
    if (!completion || !completion.confirmed) {
      return res.status(404).json({ message: 'No confirmed completion found' });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // For now, return a placeholder certificate URL
    const certificateUrl = `/api/certificates/microlearning-${userId}-${Date.now()}.pdf`;

    res.json({
      success: true,
      certificateUrl,
      completionDate: completion.completedAt,
      message: 'Certificate for skillpass.nl food safety training preparation - Complete your official certification at skillpass.nl'
    });
  } catch (error) {
    console.error('Error generating certificate:', error);
    res.status(500).json({ message: 'Failed to generate certificate' });
  }
});

export default router;

