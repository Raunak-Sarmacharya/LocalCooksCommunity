const fs = require('fs');
const path = require('path');

const routesPath = path.join(__dirname, '../server/routes.ts');
const adminPath = path.join(__dirname, '../server/routes/admin.ts');
const applicationsPath = path.join(__dirname, '../server/routes/applications.ts');
const authPath = path.join(__dirname, '../server/routes/auth.ts');
const microlearningPath = path.join(__dirname, '../server/routes/microlearning.ts');

let content = fs.readFileSync(routesPath, 'utf8');

// Helper to extract and remove
function extractAndRemove(startMarker, endRegex, destFile, replacement = '', transform = (code) => code) {
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) {
        console.log(`Marker not found: ${startMarker}`);
        return;
    }

    // Find the end based on regex starting from startIdx
    const remaining = content.substring(startIdx);
    const match = remaining.match(endRegex);
    if (!match) {
        console.log(`End regex not matched for: ${startMarker}`);
        return;
    }

    const extractedBlock = match[0];
    const endIdx = startIdx + extractedBlock.length;

    // Transform code
    let transformedCode = transform(extractedBlock);

    // Append to destination
    if (fs.existsSync(destFile)) {
        let destContent = fs.readFileSync(destFile, 'utf8');
        // If file doesn't have imports yet (like microlearning), we might need to be careful.
        // Assuming destination files exist and are modules (export default router...)
        // We usually want to append mostly, but inside the router? 
        // Or specific extraction...

        // Actually for this refactor, most target files are ALREADY extracting "router" based files.
        // So we append to the END (before `export default router` if we can find it? Or just append and fix manually?
        // Most files end with `export default router;`.
        // We really want to insert BEFORE `export default router;`.

        const exportDefaultIdx = destContent.lastIndexOf('export default router');
        if (exportDefaultIdx !== -1) {
            destContent = destContent.substring(0, exportDefaultIdx) +
                `\n${transformedCode}\n` +
                destContent.substring(exportDefaultIdx);
            fs.writeFileSync(destFile, destContent);
        } else {
            // Just append if no export default (maybe newly created)
            // But for microlearning.ts it will be new.
            fs.appendFileSync(destFile, `\n${transformedCode}\n`);
        }
    } else {
        // Create new file (Microlearning)
        // Need imports too.
        if (destFile.includes('microlearning')) {
            const header = `import { Router } from "express";
import { storage } from "../storage";
import { fileUpload } from "../fileUpload";
import { pool } from "../db";
import { isAlwaysFoodSafeConfigured, submitToAlwaysFoodSafe } from "../alwaysFoodSafe";

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

`;
            const footer = `\nexport default router;\n`;
            fs.writeFileSync(destFile, header + transformedCode + footer);
        } else {
            fs.writeFileSync(destFile, transformedCode);
        }
    }

    // Remove from source
    content = content.substring(0, startIdx) + replacement + content.substring(endIdx);
    console.log(`Extracted: ${startMarker.substring(0, 30)}...`);
}

// --- Transforms ---
const toRouter = (code) => {
    return code
        .replace(/app\.get\((['"])\/api\/admin\//g, 'router.get($1/')
        .replace(/app\.post\((['"])\/api\/admin\//g, 'router.post($1/')
        .replace(/app\.patch\((['"])\/api\/admin\//g, 'router.patch($1/')
        .replace(/app\.delete\((['"])\/api\/admin\//g, 'router.delete($1/')
        .replace(/app\.put\((['"])\/api\/admin\//g, 'router.put($1/')

        .replace(/app\.get\((['"])\/api\/applications\//g, 'router.get($1/') // applications is mounted at /api/applications? No, currently mounted at start.
        // Wait, current applications mount is just `app.use((await import...))` likely at `/api/applications` or root?
        // Let's check: `app.use("/api/applications", ...)`
        // So `/api/applications/:id` -> `/:id`.
        .replace(/app\.patch\((['"])\/api\/applications\/(.+?)(['"])/g, 'router.patch("/$2"')

        .replace(/app\.get\((['"])\/api\/microlearning\//g, 'router.get($1/')
        .replace(/app\.post\((['"])\/api\/microlearning\//g, 'router.post($1/')

        // Single replacements for specific routes
        .replace(/app\.post\((['"])\/api\/admin-login(['"])/, 'router.post($1/login$2')
        .replace(/app\.get\((['"])\/api\/get-users(['"])/, 'router.get($1/users$2')
        .replace(/app\.post\((['"])\/api\/user-exists(['"])/, 'router.post($1/user-exists$2')
        .replace(/app\.post\((['"])\/api\/auth\/send-verification-email(['"])/, 'router.post($1/send-verification-email$2')
        .replace(/app\.get\((['"])\/api\/auth\/verify-email(['"])/, 'router.get($1/verify-email$2')
        // General fallback
        .replace(/app\.(get|post|patch|delete|put|use)\(/g, 'router.$1(');
};

// --- Executions ---

// 1. Admin Login
extractAndRemove(
    "// REMOVED: Admin login endpoint",
    /[\s\S]*?app\.post\("\/api\/admin-login"[\s\S]*?\}\);/,
    adminPath, // Destination: admin.ts
    '',
    toRouter
);

// 2. Get Users
extractAndRemove(
    "// Get users endpoint",
    /[\s\S]*?app\.get\("\/api\/get-users"[\s\S]*?\}\);/,
    adminPath, // Destination: admin.ts
    '',
    toRouter
);

// 3. User Exists
extractAndRemove(
    "// Check if user exists",
    /[\s\S]*?app\.post\("\/api\/user-exists"[\s\S]*?\}\);/,
    authPath, // Destination: auth.ts
    '',
    toRouter
);

// 4. Admin Test Routes (Status Email)
// Note: May need to be careful with exact start string
extractAndRemove(
    "// Test endpoint for status change email",
    /[\s\S]*?app\.post\("\/api\/test-document-status-email"[\s\S]*?\}\);/,
    adminPath,
    '',
    toRouter
);

// 5. Application Documents (Wait, need to check if one block or two)
// They seem adjacent usually.
extractAndRemove(
    "// Application documents",
    /[\s\S]*?app\.patch\("\/api\/applications\/:id\/documents"[\s\S]*?\}\);/,
    applicationsPath,
    '',
    toRouter
);

extractAndRemove(
    "// Update application document verification",
    /[\s\S]*?app\.patch\("\/api\/applications\/:id\/document-verification"[\s\S]*?\}\);/,
    applicationsPath,
    '',
    toRouter
);


// 6. Email Verification (Auth)
extractAndRemove(
    "// Email verification endpoint",
    /[\s\S]*?app\.get\("\/api\/auth\/verify-email"[\s\S]*?\}\);/,
    authPath,
    '',
    toRouter
);


// 7. Promo Email (Admin)
extractAndRemove(
    "// Admin endpoint to send promo emails",
    /[\s\S]*?app\.post\('(\/api)?\/admin\/send-promo-email'[\s\S]*?\}\);/, // handle quote variance
    adminPath,
    '',
    toRouter
);

// 8. Microlearning (ALL)
// We extract from the first microlearning comment to the end of the last function
extractAndRemove(
    "// Get user's microlearning access level",
    /[\s\S]*?app\.get\("\/api\/microlearning\/certificate\/:userId"[\s\S]*?\}\);\s*\}\s*catch\s*\(error\)[\s\S]*?\}\s*\);/,
    microlearningPath,
    '\n  app.use("/api/microlearning", (await import("./routes/microlearning")).default);\n',
    toRouter
);
// Note: Should match the Catch block of the last function?
// The regex above tries to match `});` then optional spaces/catch...
// Actually, `app.get` usually ends with `});`.
// The view showed:
// 1012:   });
// So just `\}\);` should work.

// 8b. Capture `hasApprovedApplication` helper if it was before Microlearning? 
// It was at line 748.
extractAndRemove(
    "// Helper to check if user has approved application",
    /[\s\S]*?const hasApprovedApplication =[\s\S]*?\};\n/,
    microlearningPath, // It's duplicated in the header of microlearningPath now so just remove.
    '',
    (code) => '' // Remove completely as we defined it in the new file header manually
);


// 9. Password Reset (Commented) -> Remove or Move to Auth (commented)
// Let's just remove it to clean up if it's disabled.
// Or append to auth (as commented).
extractAndRemove(
    "// Password reset request endpoint - TEMPORARILY DISABLED",
    /[\s\S]*?\*\/\n/, // Matches until `*/\n`
    authPath,
    '',
    (code) => `\n${code}\n` // Keep it commented
);

// Capture second block of password reset
extractAndRemove(
    "// Password reset confirmation endpoint - TEMPORARILY DISABLED",
    /[\s\S]*?\*\//,
    authPath,
    '',
    (code) => `\n${code}\n`
);

// Final: Write back routes.ts
fs.writeFileSync(routesPath, content);
console.log('Refactoring complete.');
