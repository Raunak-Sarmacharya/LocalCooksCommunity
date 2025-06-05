#!/usr/bin/env node

/**
 * Microlearning Routes Verification & Patching Script
 * 
 * This script ensures that the critical microlearning routes are present
 * in the production API file. Instead of trying to sync everything,
 * it focuses on the specific routes that were causing 404 errors.
 * 
 * This is a practical solution that solves the immediate problem
 * while maintaining the existing working code.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_FILE = path.join(__dirname, '../api/index.js');

console.log('🔧 Ensuring microlearning routes are present...');

// The missing microlearning routes that need to be added
const MICROLEARNING_ROUTES = `
// Microlearning Routes - Auto-added by ensure-microlearning-routes.js
// These routes were missing and causing 404 errors

// Get microlearning progress for a user
app.get("/api/microlearning/progress/:userId", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userId = parseInt(req.params.userId);

    // Verify user can access this data (either their own or admin)
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Access denied" });
    }

    const progress = await getMicrolearningProgress(userId);
    res.json(progress);
  } catch (error) {
    console.error('Error getting microlearning progress:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Update video progress
app.post("/api/microlearning/progress", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const { videoId, progress } = req.body;
    const userId = req.user.id;

    if (!videoId || progress === undefined) {
      return res.status(400).json({ message: "Video ID and progress are required" });
    }

    // Validate progress is between 0 and 100
    const validProgress = Math.max(0, Math.min(100, parseFloat(progress)));

    const result = await updateVideoProgress({
      userId,
      videoId: parseInt(videoId),
      progress: validProgress,
      completed: validProgress >= 90
    });

    res.json(result);
  } catch (error) {
    console.error('Error updating video progress:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Complete microlearning training
app.post("/api/microlearning/complete", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userId = req.user.id;

    // Check if user has completed all 10 modules
    const progress = await getMicrolearningProgress(userId);
    
    if (progress.completedVideos < 10) {
      return res.status(400).json({ 
        message: "All 10 modules must be completed before certification",
        completedVideos: progress.completedVideos,
        requiredVideos: 10
      });
    }

    // Create completion record
    const completion = await createMicrolearningCompletion({
      userId,
      completedAt: new Date(),
      progress: progress.videoProgress
    });

    res.json({
      success: true,
      completion,
      message: "Congratulations! You have completed the microlearning training."
    });
  } catch (error) {
    console.error('Error completing microlearning:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Get completion certificate
app.get("/api/microlearning/certificate/:userId", async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const userId = parseInt(req.params.userId);

    // Verify user can access this certificate (either their own or admin)
    if (req.user.id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ message: "Access denied" });
    }

    const completion = await getMicrolearningCompletion(userId);
    
    if (!completion) {
      return res.status(404).json({ 
        message: "No completion certificate found. Complete all training modules first." 
      });
    }

    // Generate certificate data
    const certificate = {
      userId,
      userName: req.user.full_name || req.user.username,
      completedAt: completion.completed_at,
      certificateId: 'LC-' + userId + '-' + new Date(completion.completed_at).getFullYear(),
      modules: Object.keys(completion.progress || {}).length,
      issuer: "LocalCooks Community",
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year validity
    };

    res.json(certificate);
  } catch (error) {
    console.error('Error getting certificate:', error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// End of microlearning routes
`;

function checkIfRoutesExist(content) {
  const requiredRoutes = [
    '/api/microlearning/progress/:userId',
    '/api/microlearning/progress',
    '/api/microlearning/complete',
    '/api/microlearning/certificate/:userId'
  ];

  const missingRoutes = [];
  
  for (const route of requiredRoutes) {
    if (!content.includes(route)) {
      missingRoutes.push(route);
    }
  }

  return missingRoutes;
}

function addMicrolearningRoutes() {
  try {
    // Read the current API file
    if (!fs.existsSync(API_FILE)) {
      console.error('❌ API file not found:', API_FILE);
      process.exit(1);
    }

    let content = fs.readFileSync(API_FILE, 'utf8');
    console.log('✅ Read API file');

    // Check which routes are missing
    const missingRoutes = checkIfRoutesExist(content);
    
    if (missingRoutes.length === 0) {
      console.log('✅ All microlearning routes are already present');
      console.log('🎉 No changes needed!');
      return;
    }

    console.log(`🔍 Found ${missingRoutes.length} missing routes:`);
    missingRoutes.forEach(route => console.log(`   - ${route}`));

    // Backup the current file
    const backupPath = `${API_FILE}.backup.${Date.now()}`;
    fs.copyFileSync(API_FILE, backupPath);
    console.log(`📦 Backed up API file to ${path.basename(backupPath)}`);

    // Find the insertion point (before the export statement)
    const exportIndex = content.lastIndexOf('export default app;');
    
    if (exportIndex === -1) {
      console.error('❌ Could not find export statement in API file');
      process.exit(1);
    }

    // Insert the microlearning routes before the export
    const beforeExport = content.substring(0, exportIndex);
    const afterExport = content.substring(exportIndex);
    
    const newContent = beforeExport + MICROLEARNING_ROUTES + '\n' + afterExport;

    // Write the updated file
    fs.writeFileSync(API_FILE, newContent);
    console.log('✅ Added microlearning routes to API file');

    // Verify the routes were added
    const verifyContent = fs.readFileSync(API_FILE, 'utf8');
    const stillMissing = checkIfRoutesExist(verifyContent);
    
    if (stillMissing.length === 0) {
      console.log('');
      console.log('🎉 Successfully added all microlearning routes!');
      console.log('📊 Added routes:');
      missingRoutes.forEach(route => console.log(`   ✅ ${route}`));
      console.log('');
      console.log('🚀 The microlearning training system should now work correctly');
      console.log('💡 Test the training page to verify functionality');
    } else {
      console.error('❌ Some routes are still missing after insertion');
      stillMissing.forEach(route => console.error(`   - ${route}`));
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Error adding microlearning routes:', error.message);
    process.exit(1);
  }
}

// Run if called directly
const scriptPath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === scriptPath;

if (isMainModule) {
  addMicrolearningRoutes();
}

export { addMicrolearningRoutes };
