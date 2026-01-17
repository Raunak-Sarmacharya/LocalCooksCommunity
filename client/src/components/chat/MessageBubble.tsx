import { Download, FileText, ChefHat, Shield, User } from 'lucide-react';
import { format } from 'date-fns';
import type { ChatMessage } from '@/services/chat-service';

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  chefName?: string;
  managerName?: string;
}

type UserRole = 'chef' | 'manager' | 'system';

const ROLE_CONFIG = {
  chef: {
    icon: ChefHat,
    colors: {
      bg: 'bg-orange-50',
      text: 'text-orange-900',
      border: 'border-orange-200',
      avatar: 'bg-orange-500',
    },
    defaultLabel: 'Chef',
  },
  manager: {
    icon: Shield,
    colors: {
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      border: 'border-blue-200',
      avatar: 'bg-blue-500',
    },
    defaultLabel: 'Manager',
  },
  system: {
    icon: User,
    colors: {
      bg: 'bg-gray-50',
      text: 'text-gray-900',
      border: 'border-gray-200',
      avatar: 'bg-gray-500',
    },
    defaultLabel: 'System',
  },
} as const;

function getRoleConfig(role: UserRole) {
  return ROLE_CONFIG[role] || ROLE_CONFIG.system;
}

export default function MessageBubble({ message, isOwn, chefName, managerName }: MessageBubbleProps) {
  const createdAt = message.createdAt instanceof Date
    ? message.createdAt
    : message.createdAt?.toDate?.() || new Date();

  const roleConfig = getRoleConfig(message.senderRole as UserRole);
  const RoleIcon = roleConfig.icon;

  // Get the actual display name based on role
  const getDisplayName = (role: UserRole): string => {
    switch (role) {
      case 'chef':
        return chefName || roleConfig.defaultLabel;
      case 'manager':
        return managerName || roleConfig.defaultLabel;
      default:
        return roleConfig.defaultLabel;
    }
  };

  const displayName = getDisplayName(message.senderRole as UserRole);

  // For own messages, use the brand color
  const ownColors = {
    bg: 'bg-[#208D80]',
    text: 'text-white',
    border: 'border-[#208D80]',
    avatar: 'bg-[#208D80]',
  };

  const colors = isOwn ? ownColors : roleConfig.colors;

  return (
    <article
      className={`flex gap-3 ${isOwn ? 'justify-end' : 'justify-start'} items-start group`}
      role="article"
      aria-label={`Message from ${displayName} at ${format(createdAt, 'HH:mm')}`}
    >
      {/* Avatar for other users (left side) */}
      {!isOwn && (
        <div className="flex-shrink-0">
          <div
            className={`w-8 h-8 rounded-full ${colors.avatar} text-white flex items-center justify-center shadow-sm ring-2 ring-white`}
            role="img"
            aria-label={`${displayName} avatar`}
          >
            <RoleIcon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Message content */}
      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[70%]`}>
        {/* Sender label for other users */}
        {!isOwn && (
          <header className="flex items-center gap-2 mb-1 px-1">
            <span className="text-xs font-medium text-gray-600">
              {displayName}
            </span>
          </header>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-4 py-2 shadow-sm ${colors.bg} ${colors.text} border ${colors.border} ${
            isOwn ? 'rounded-br-sm' : 'rounded-bl-sm'
          }`}
        >
          {message.type === 'file' && message.fileUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                <span className="font-medium break-all">{message.fileName || 'File'}</span>
              </div>
              {message.content && (
                <p className="text-sm">{message.content}</p>
              )}
              <a
                href={message.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1 text-sm underline transition-colors ${
                  isOwn
                    ? 'text-white/80 hover:text-white focus:text-white'
                    : 'text-blue-600 hover:text-blue-800 focus:text-blue-800'
                } focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500`}
                aria-label={`Download ${message.fileName || 'file'}`}
              >
                <Download className="h-3 w-3" aria-hidden="true" />
                Download
              </a>
            </div>
          ) : (
            <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
          )}

          {/* Timestamp */}
          <time
            className={`block text-xs mt-1 ${
              isOwn ? 'text-white/70' : 'text-gray-500'
            }`}
            dateTime={createdAt.toISOString()}
          >
            {format(createdAt, 'HH:mm')}
          </time>
        </div>
      </div>

      {/* Avatar for own messages (right side) */}
      {isOwn && (
        <div className="flex-shrink-0">
          <div
            className={`w-8 h-8 rounded-full ${colors.avatar} text-white flex items-center justify-center shadow-sm ring-2 ring-white`}
            role="img"
            aria-label={`${displayName} avatar`}
          >
            <RoleIcon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      )}
    </article>
  );
}
