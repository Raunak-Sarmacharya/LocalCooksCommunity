import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import "@/types/tidio.d.ts";

// Enterprise-Grade Tidio Chat Widget Controller
//
// Architecture (Lazy Loading — Intercom/Zendesk pattern):
// 1. Script is NOT loaded on dashboard mount — zero overhead on non-support pages
// 2. Script loads ONLY when chef visits support page or has an active chat session
// 3. Visitor identity is set via document.tidioIdentify BEFORE script loads (merges conversations)
// 4. Widget is hidden immediately on ready, then shown only on support page or active chat
// 5. Once chef starts a conversation, chat persists across pages until they close it
// 6. All event listeners are properly cleaned up with .off() on unmount
// 7. useTidioChat hook triggers lazy load + open for "Start Chat" buttons on support page

const TIDIO_SCRIPT_ID = "tidio-chat-script";
const TIDIO_SCRIPT_SRC = "//code.tidio.co/xttrfsraxgqfnetg9kbnxl2mppgex2fi.js";
const TIDIO_CHAT_ACTIVE_KEY = "tidio_chat_active";

// Session storage helpers
const hasActiveChatSession = (): boolean => {
  try {
    return sessionStorage.getItem(TIDIO_CHAT_ACTIVE_KEY) === "true";
  } catch {
    return false;
  }
};

const setActiveChatSession = (active: boolean): void => {
  try {
    if (active) {
      sessionStorage.setItem(TIDIO_CHAT_ACTIVE_KEY, "true");
    } else {
      sessionStorage.removeItem(TIDIO_CHAT_ACTIVE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
};

// Check if current view is a support page
const isOnSupportPage = (): boolean => {
  const view = new URLSearchParams(window.location.search).get("view");
  return view === "support" || view === "feedback";
};

// Check if Tidio script is already injected
const isScriptInjected = (): boolean => !!document.getElementById(TIDIO_SCRIPT_ID);

// Dynamically inject the Tidio script tag (idempotent)
const injectTidioScript = (): void => {
  if (isScriptInjected()) return;
  const script = document.createElement("script");
  script.id = TIDIO_SCRIPT_ID;
  script.src = TIDIO_SCRIPT_SRC;
  script.async = true;
  document.body.appendChild(script);
};

// Set visitor identity for conversation merging (must be called before script loads)
const ensureVisitorIdentity = (userId?: string, userEmail?: string, userName?: string): void => {
  if (userEmail || userName || userId) {
    window.tidioIdentify = {
      distinct_id: userId,
      email: userEmail,
      name: userName,
    };
  }
};

interface TidioControllerProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
}

export default function TidioController({ userEmail, userName, userId }: TidioControllerProps) {
  const [location] = useLocation();
  const listenersAttached = useRef(false);
  const chatOpenRef = useRef(false);
  const identitySetRef = useRef(false);

  // Named handler refs for proper cleanup via .off()
  const onOpenRef = useRef<(() => void) | null>(null);
  const onCloseRef = useRef<(() => void) | null>(null);
  const onConversationStartRef = useRef<(() => void) | null>(null);
  const onConversationEndRef = useRef<(() => void) | null>(null);

  // Step 1: Set visitor identity once (before any script load)
  useEffect(() => {
    if (!identitySetRef.current && (userEmail || userName || userId)) {
      ensureVisitorIdentity(userId, userEmail, userName);
      identitySetRef.current = true;
    }
  }, [userEmail, userName, userId]);

  // Step 2: Lazy-load Tidio script ONLY when needed (support page or active chat session)
  useEffect(() => {
    const shouldLoad = isOnSupportPage() || hasActiveChatSession();
    if (shouldLoad) {
      ensureVisitorIdentity(userId, userEmail, userName);
      injectTidioScript();
    }
  }, [location, userEmail, userName, userId]);

  // Step 3: Once Tidio is ready, hide widget and attach event listeners (once)
  useEffect(() => {
    const attachListeners = () => {
      if (!window.tidioChatApi || listenersAttached.current) return;
      listenersAttached.current = true;

      // Hide widget immediately — chef must explicitly open it from support page
      window.tidioChatApi.hide();

      // If on support page or has active session, show the bubble
      if (isOnSupportPage() || hasActiveChatSession()) {
        window.tidioChatApi.show();
      }

      // Define named handlers so we can remove them with .off()
      onOpenRef.current = () => {
        chatOpenRef.current = true;
      };

      onCloseRef.current = () => {
        chatOpenRef.current = false;
        // Chef manually closed the chat — clear session so it won't reappear on reload
        setActiveChatSession(false);
        // Hide the widget bubble too, UNLESS they're on the support page
        if (!isOnSupportPage()) {
          window.tidioChatApi?.hide();
        }
      };

      onConversationStartRef.current = () => {
        // Chef sent their first message — persist chat across pages
        setActiveChatSession(true);
        chatOpenRef.current = true;
      };

      onConversationEndRef.current = () => {
        // Conversation resolved by agent/timeout — clean up
        setActiveChatSession(false);
        chatOpenRef.current = false;
      };

      window.tidioChatApi.on("open", onOpenRef.current);
      window.tidioChatApi.on("close", onCloseRef.current);
      window.tidioChatApi.on("conversationStart", onConversationStartRef.current);
      window.tidioChatApi.on("conversationEnd", onConversationEndRef.current);
    };

    // Tidio may already be loaded (SPA navigation back to dashboard)
    if (window.tidioChatApi) {
      attachListeners();
    } else {
      const onReady = () => {
        // Hide immediately on load before any automation can fire
        window.tidioChatApi?.hide();
        attachListeners();
      };
      document.addEventListener("tidioChat-ready", onReady);
      return () => {
        document.removeEventListener("tidioChat-ready", onReady);
      };
    }

    // Cleanup: remove Tidio event listeners on unmount
    return () => {
      if (window.tidioChatApi && listenersAttached.current) {
        if (onOpenRef.current) window.tidioChatApi.off("open", onOpenRef.current);
        if (onCloseRef.current) window.tidioChatApi.off("close", onCloseRef.current);
        if (onConversationStartRef.current) window.tidioChatApi.off("conversationStart", onConversationStartRef.current);
        if (onConversationEndRef.current) window.tidioChatApi.off("conversationEnd", onConversationEndRef.current);
        listenersAttached.current = false;
      }
    };
  }, []);

  // Step 4: React to SPA navigation — show/hide widget based on page context
  useEffect(() => {
    if (!window.tidioChatApi) return;

    if (isOnSupportPage() || hasActiveChatSession()) {
      window.tidioChatApi.show();
    } else if (!chatOpenRef.current) {
      // Not on support page, no active session, chat popup not open — hide bubble
      window.tidioChatApi.hide();
    }
    // If chatOpenRef.current is true (popup is open), do nothing — let the user finish their chat
  }, [location]);

  return null;
}

// Hook to programmatically open Tidio chat from support page buttons
// Triggers lazy loading of the script if not yet loaded
export function useTidioChat() {
  const openChat = useCallback(() => {
    // If Tidio is already loaded, open immediately
    if (window.tidioChatApi) {
      window.tidioChatApi.show();
      window.tidioChatApi.open();
      return;
    }

    // Tidio not yet loaded — inject script and open when ready
    injectTidioScript();
    const onReady = () => {
      if (window.tidioChatApi) {
        window.tidioChatApi.show();
        window.tidioChatApi.open();
      }
    };
    document.addEventListener("tidioChat-ready", onReady, { once: true });
  }, []);

  const closeChat = useCallback(() => {
    if (window.tidioChatApi) {
      window.tidioChatApi.close();
    }
  }, []);

  const hideWidget = useCallback(() => {
    if (window.tidioChatApi) {
      window.tidioChatApi.hide();
    }
  }, []);

  const showWidget = useCallback(() => {
    if (window.tidioChatApi) {
      window.tidioChatApi.show();
    }
  }, []);

  return { openChat, closeChat, hideWidget, showWidget };
}
