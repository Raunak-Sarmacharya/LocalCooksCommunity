import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import "@/types/tidio.d.ts";

// Tidio Chat Widget Controller
// Controls visibility of Tidio chat widget based on current page
// Widget is hidden by default and only shown on support pages or when user has active chat

// Storage key for tracking if user has an active chat session
const TIDIO_CHAT_ACTIVE_KEY = "tidio_chat_active";

// Pages where Tidio widget should be visible
const SUPPORT_PAGES = ["/dashboard?view=support", "/dashboard?view=feedback"];

// Check if current URL is a support page
const isSupportPage = (pathname: string, search: string): boolean => {
  const fullPath = pathname + search;
  return SUPPORT_PAGES.some(page => fullPath.includes(page.replace("/dashboard", "")));
};

// Check if user has an active chat session
const hasActiveChatSession = (): boolean => {
  try {
    return sessionStorage.getItem(TIDIO_CHAT_ACTIVE_KEY) === "true";
  } catch {
    return false;
  }
};

// Set active chat session state
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

interface TidioControllerProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
}

export default function TidioController({ userEmail, userName, userId }: TidioControllerProps) {
  const [location] = useLocation();
  const isInitialized = useRef(false);
  const conversationOpenRef = useRef(false);

  useEffect(() => {
    const initTidio = () => {
      if (!window.tidioChatApi) return;

      // Set visitor data if available
      if (userEmail || userName || userId) {
        window.tidioChatApi.setVisitorData({
          distinct_id: userId,
          email: userEmail,
          name: userName,
        });
      }

      // Parse current location
      const searchParams = new URLSearchParams(window.location.search);
      const view = searchParams.get("view");
      const isOnSupportPage = view === "support" || view === "feedback";
      const hasActiveChat = hasActiveChatSession();

      // Determine if widget should be visible
      const shouldShowWidget = isOnSupportPage || hasActiveChat;

      if (shouldShowWidget) {
        window.tidioChatApi.show();
      } else {
        window.tidioChatApi.hide();
      }

      // Set up event listeners for chat state changes
      if (!isInitialized.current) {
        isInitialized.current = true;

        // When user opens the chat (clicks the bubble or we open it programmatically)
        window.tidioChatApi.on("open", () => {
          conversationOpenRef.current = true;
        });

        // When chat conversation starts (user sends first message)
        window.tidioChatApi.on("conversationStart", () => {
          setActiveChatSession(true);
          conversationOpenRef.current = true;
        });

        // When chat is closed by user
        window.tidioChatApi.on("close", () => {
          conversationOpenRef.current = false;
          // Check if we should hide the widget after closing
          const searchParams = new URLSearchParams(window.location.search);
          const view = searchParams.get("view");
          const isOnSupportPage = view === "support" || view === "feedback";
          
          // Only hide if not on support page and no active chat session
          if (!isOnSupportPage && !hasActiveChatSession()) {
            window.tidioChatApi?.hide();
          }
        });

        // When conversation ends (resolved/closed by agent or timeout)
        window.tidioChatApi.on("conversationEnd", () => {
          setActiveChatSession(false);
          conversationOpenRef.current = false;
        });
      }
    };

    // Handle Tidio ready event
    const onTidioChatApiReady = () => {
      // Hide widget immediately on load
      if (window.tidioChatApi) {
        window.tidioChatApi.hide();
      }
      initTidio();
    };

    // Check if Tidio is already loaded
    if (window.tidioChatApi) {
      initTidio();
    } else {
      // Wait for Tidio to load
      document.addEventListener("tidioChat-ready", onTidioChatApiReady);
    }

    return () => {
      document.removeEventListener("tidioChat-ready", onTidioChatApiReady);
    };
  }, [userEmail, userName, userId]);

  // React to location changes
  useEffect(() => {
    if (!window.tidioChatApi) return;

    const searchParams = new URLSearchParams(window.location.search);
    const view = searchParams.get("view");
    const isOnSupportPage = view === "support" || view === "feedback";
    const hasActiveChat = hasActiveChatSession();

    // Show widget on support pages or if user has active chat
    if (isOnSupportPage || hasActiveChat) {
      window.tidioChatApi.show();
    } else {
      // Hide widget when leaving support page (unless chat is open)
      if (!conversationOpenRef.current) {
        window.tidioChatApi.hide();
      }
    }
  }, [location]);

  // This component doesn't render anything
  return null;
}

// Hook to programmatically open Tidio chat
export function useTidioChat() {
  const openChat = () => {
    if (window.tidioChatApi) {
      window.tidioChatApi.show();
      window.tidioChatApi.open();
    }
  };

  const closeChat = () => {
    if (window.tidioChatApi) {
      window.tidioChatApi.close();
    }
  };

  const hideWidget = () => {
    if (window.tidioChatApi) {
      window.tidioChatApi.hide();
    }
  };

  const showWidget = () => {
    if (window.tidioChatApi) {
      window.tidioChatApi.show();
    }
  };

  return { openChat, closeChat, hideWidget, showWidget };
}
