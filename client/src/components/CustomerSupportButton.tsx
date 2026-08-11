import { MessageCircle } from "lucide-react";
import { useTidioChat } from "./chat/TidioController";

export default function CustomerSupportButton() {
  const { openChat } = useTidioChat();

  return (
    <button
      onClick={openChat}
      className="fixed bottom-6 left-6 z-[9999] bg-gradient-to-r from-[#F51042] to-rose-500 hover:from-rose-500 hover:to-[#F51042] text-white px-4 py-3 sm:px-5 sm:py-3.5 rounded-full shadow-xl hover:shadow-2xl hover:shadow-[#F51042]/30 hover:scale-105 transition-all duration-300 flex items-center justify-center"
      aria-label="Open Customer Support Chat"
    >
      <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0" />
      <span className="ml-2 font-medium whitespace-nowrap text-sm sm:text-base">
        Support
      </span>
    </button>
  );
}
