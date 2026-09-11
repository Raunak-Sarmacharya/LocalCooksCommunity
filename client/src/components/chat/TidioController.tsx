import { useEffect, useCallback } from "react";
import { openTidioChat, setTidioVisitorIdentity } from "@/lib/tidio";

interface TidioControllerProps {
  userEmail?: string;
  userName?: string;
  userId?: string;
}

export default function TidioController({ userEmail, userName, userId }: TidioControllerProps) {
  useEffect(() => {
    setTidioVisitorIdentity({
      distinct_id: userId,
      email: userEmail,
      name: userName,
    });
  }, [userEmail, userName, userId]);

  return null;
}

export function useTidioChat() {
  const openChat = useCallback(() => {
    void openTidioChat();
  }, []);

  return { openChat };
}
