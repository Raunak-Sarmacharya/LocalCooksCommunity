import { Info } from 'lucide-react';
import type { ChatMessage } from '@/services/chat-service';

interface SystemMessageProps {
  message: ChatMessage;
}

export default function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 max-w-[80%]">
        <Info className="h-4 w-4 text-blue-600 flex-shrink-0" />
        <p className="text-sm text-blue-900">{message.content}</p>
      </div>
    </div>
  );
}
