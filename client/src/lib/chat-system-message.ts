/**
 * Rewrite legacy Step 1–4 system messages for display.
 * Firestore still holds old copy from before kitchen-coordination terminology.
 */
const READY =
  "Kitchen coordination complete: You're approved to book this kitchen.";
const OPEN_CHAT =
  "Request to apply approved: Chat with your kitchen manager is now open. Upload your kitchen coordination documents to continue.";
const SUBMITTED =
  "Kitchen coordination submitted: Your documents are with the kitchen manager for review.";

const EXACT: Record<string, string> = {
  "Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved.":
    READY,
  "✅ Step 2 Complete: All kitchen coordination requirements have been met. Your application is now fully approved.":
    READY,
  "All kitchen coordination requirements have been met. Your application is now fully approved.":
    READY,
  "Request to apply approved: You can now proceed to upload your kitchen documents.":
    OPEN_CHAT,
  "✅ Request to apply approved: Your food handler certificate has been verified. You can now proceed to kitchen documents.":
    OPEN_CHAT,
  "✅ Step 1 Approved: Your food handler certificate has been verified. You can now proceed to Step 2 - Kitchen Coordination.":
    OPEN_CHAT,
  "📋 Step 3 Submitted: Your government application has been submitted. We'll notify you once it's approved.":
    SUBMITTED,
  "🎉 Step 4 Approved: Congratulations! Your license has been entered and you're fully approved to use the kitchen.":
    READY,
};

export function normalizeChatSystemMessage(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;

  const exact = EXACT[trimmed];
  if (exact) return exact;

  // Strip leading status emoji if an exact match missed a variant
  const withoutEmoji = trimmed.replace(/^[✅❌📋🎉📊📄]\s*/, "");
  const exact2 = EXACT[withoutEmoji] ?? EXACT[`✅ ${withoutEmoji}`] ?? EXACT[`📋 ${withoutEmoji}`] ?? EXACT[`🎉 ${withoutEmoji}`];
  if (exact2) return exact2;

  if (/step\s*2\s*complete/i.test(withoutEmoji) || /kitchen coordination requirements have been met/i.test(withoutEmoji)) {
    return READY;
  }
  if (/step\s*3\s*submitted/i.test(withoutEmoji) || /government application has been submitted/i.test(withoutEmoji)) {
    return SUBMITTED;
  }
  if (/step\s*4\s*approved/i.test(withoutEmoji) || /license has been entered/i.test(withoutEmoji)) {
    return READY;
  }
  if (/step\s*1\s*approved/i.test(withoutEmoji) || /food handler certificate has been verified/i.test(withoutEmoji)) {
    return OPEN_CHAT;
  }

  return content;
}
