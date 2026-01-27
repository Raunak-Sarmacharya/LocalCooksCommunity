import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { requireFirebaseAuthWithUser } from "../firebase-auth-middleware";
import { logger } from "../logger";

const router = Router();

// Get JWT signature for SuprSend Inbox (ES256)
router.get("/verification", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    const distinctId = user.firebaseUid || user.id.toString();
    const signingKey = process.env.SUPRSEND_INBOX_SIGNING_KEY;

    // Use replace/trim to handle potential formatting issues with newlines in .env
    // Handle both literal \n and real newlines, and strip quotes if they leaked in
    const formattedKey = signingKey?.replace(/\\n/g, '\n').replace(/^"|"$/g, '').trim();

    logger.info(`[SuprSend] Debug Env - Signing Key present: ${!!signingKey}, Formatted length: ${formattedKey?.length}`);
    
    // Debug the exact start and end of the key to catch copy-paste errors
    if (formattedKey) {
        const lines = formattedKey.split('\n');
        logger.info(`[SuprSend] Key Debug - Line count: ${lines.length}`);
        logger.info(`[SuprSend] Key Debug - First Line: '${lines[0]}'`);
        logger.info(`[SuprSend] Key Debug - Last Line: '${lines[lines.length - 1]}'`);
        logger.info(`[SuprSend] Key Debug - Is PEM: ${formattedKey.includes('-----BEGIN PRIVATE KEY-----')}`);
    }

    if (!formattedKey || formattedKey.length < 100) {
       logger.error(`[SuprSend] Invalid Key Format. Length: ${formattedKey?.length}. Should be a full PEM Private Key.`);
       return res.status(500).json({ 
           error: "Configuration Error", 
           details: "SUPRSEND_INBOX_SIGNING_KEY is missing or invalid. Ensure it's the FULL Private Key from SuprSend Dashboard." 
       });
    }

    if (!distinctId) {
        return res.status(400).json({ error: "User identifier missing" });
    }

    logger.info(`[SuprSend] Generating JWT for entity_id: ${distinctId}`);
    
    const payload = {
        entity_type: 'subscriber', 
        entity_id: distinctId 
    };

    // Generate JWT signed with ES256
    const userToken = jwt.sign(
      payload,
      formattedKey,
      { algorithm: "ES256", expiresIn: "1y" }
    );

    res.json({ 
        distinctId,
        userToken 
    });

  } catch (error: any) {
    logger.error("[SuprSend] Error generating verification signature:", error);
    // Send exact error to client for debugging
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});

// Initialize SuprSend SDK (lazy initialization to avoid errors if keys missing at startup)
let suprClient: any = null;

async function getSuprClient() {
  if (suprClient) return suprClient;
  
  const workspaceKey = process.env.VITE_SUPRSEND_WORKSPACE_KEY || process.env.SUPRSEND_WORKSPACE_KEY;
  const workspaceSecret = process.env.SUPRSEND_WORKSPACE_SECRET;

  if (!workspaceKey || !workspaceSecret) {
    logger.error("[SuprSend] Missing keys for SDK initialization. Need VITE_SUPRSEND_WORKSPACE_KEY and SUPRSEND_WORKSPACE_SECRET.");
    return null;
  }

  try {
    const { Suprsend } = await import("@suprsend/node-sdk");
    suprClient = new Suprsend(workspaceKey, workspaceSecret);
    return suprClient;
  } catch (err) {
    logger.error("[SuprSend] Failed to import/init SDK:", err);
    return null;
  }
}

// Trigger a test notification
router.post("/trigger-test", requireFirebaseAuthWithUser, async (req: Request, res: Response) => {
  try {
    const user = req.neonUser!;
    const distinctId = user.firebaseUid || user.id.toString();
    const client = await getSuprClient();

    if (!client) {
        return res.status(500).json({ error: "SuprSend SDK not initialized (check server logs for missing keys)" });
    }

    // Trigger a generic event "TEST_NOTIFICATION"
    // The user must set up a Workflow in SuprSend dashboard listening to this event
    const eventName = "TEST_NOTIFICATION";
    const properties = {
        title: "Test Notification",
        message: "This is a test notification from your Local Cooks Dashboard!",
        time: new Date().toISOString()
    };

    const response = await client.track(distinctId, eventName, properties);

    if (response.success) {
        res.json({ success: true, message: `Triggered event '${eventName}' for user ${distinctId}` });
    } else {
        logger.error("[SuprSend] Trigger failed:", response);
        res.status(500).json({ error: "Failed to trigger notification", details: response });
    }

  } catch (error) {
    logger.error("[SuprSend] Error triggering test:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
