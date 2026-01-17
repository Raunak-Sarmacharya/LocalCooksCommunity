import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import MessageBubble from './MessageBubble';
import SystemMessage from './SystemMessage';
import type { ChatMessage } from '@/services/chat-service';

interface MessageListProps {
  messages: ChatMessage[];
  currentUserId: number;
  chefName?: string;
  managerName?: string;
  messagesEndRef?: React.RefObject<HTMLDivElement>;
}

export default function MessageList({ messages, currentUserId, chefName, managerName, messagesEndRef }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No messages yet. Start the conversation!
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="p-4 space-y-4">
        {messages.map((message) => {
          if (message.senderRole === 'system') {
            return <SystemMessage key={message.id} message={message} />;
          }
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={message.senderId === currentUserId}
              chefName={chefName}
              managerName={managerName}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}
