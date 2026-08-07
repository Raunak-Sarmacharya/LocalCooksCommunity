import { Router } from "express";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

// Get seller analytics data from the PHP backend
router.get("/seller/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    
    // 1. Fetch user from Neon Postgres to get the phpShopId (which is 'sid' in MySQL)
    const user = await db.query.users.findFirst({
      where: eq(users.firebaseUid, uid),
    });

    if (!user || !user.phpShopId) {
      // If the user has no linked PHP shop, return empty data
      return res.json({ heatmap: [], topAreas: [] });
    }

    const sid = user.phpShopId;

    // 2. Fetch the analytics data from the newly created PHP API
    // We use stagingwebapp.localcook.shop as it's the known domain mapping to the FTP root
    const phpApiUrl = `https://stagingwebapp.localcook.shop/app/seller_analytics_api.php?sid=${sid}`;
    
    const response = await fetch(phpApiUrl);
    
    if (!response.ok) {
      console.error(`Failed to fetch from PHP API: ${response.status} ${response.statusText}`);
      throw new Error("Failed to fetch analytics from PHP backend");
    }

    const data = await response.json();
    
    res.json(data);
  } catch (error) {
    console.error("Analytics Error:", error);
    res.status(500).json({ error: "Failed to fetch analytics data" });
  }
});

export default router;
