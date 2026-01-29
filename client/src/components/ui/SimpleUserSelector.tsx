import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, User, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  displayText: string;
}

// Extended interface to support both database users and custom emails
interface Recipient {
  id: string; // Use email as ID for custom emails, user.id for database users
  email: string;
  name: string;
  isCustomEmail: boolean; // Flag to distinguish custom emails from database users
  role?: string; // Only for database users
}

interface SimpleUserSelectorProps {
  selectedUsers: User[];
  onUsersChange: (users: User[]) => void;
  // New props for enhanced functionality
  selectedRecipients?: Recipient[];
  onRecipientsChange?: (recipients: Recipient[]) => void;
  placeholder?: string;
  maxUsers?: number;
  className?: string;
  allowCustomEmails?: boolean; // New prop to enable custom email functionality
}

export const SimpleUserSelector: React.FC<SimpleUserSelectorProps> = ({
  selectedUsers,
  onUsersChange,
  selectedRecipients = [],
  onRecipientsChange,
  placeholder = "Search users by name or email, or type a custom email...",
  maxUsers = 10,
  className = "",
  allowCustomEmails = true
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Email validation helper
  const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Fetch users from API
  const fetchUsers = async (search: string = '') => {
    setIsLoading(true);
    try {
      const url = search
        ? `/api/admin/users?search=${encodeURIComponent(search)}`
        : '/api/admin/users';

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        // Filter out already selected users
        const filteredUsers = data.users.filter(
          (user: User) => !selectedUsers.some(selected => selected.id === user.id)
        );
        setAvailableUsers(filteredUsers);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchTerm.trim() || isDropdownOpen) {
        fetchUsers(searchTerm);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm, selectedUsers, isDropdownOpen]);

  // Handle input focus
  const handleInputFocus = () => {
    setIsDropdownOpen(true);
    if (availableUsers.length === 0) {
      fetchUsers();
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsDropdownOpen(true);
  };

  // Handle user selection from database
  const handleUserSelect = (user: User) => {
    console.log('User selected:', user);
    const totalRecipients = selectedUsers.length + selectedRecipients.length;
    if (totalRecipients < maxUsers) {
      onUsersChange([...selectedUsers, user]);
      setSearchTerm('');
      setIsDropdownOpen(false);
    }
  };

  // Handle custom email addition
  const handleCustomEmailAdd = () => {
    if (!allowCustomEmails) return;

    const email = searchTerm.trim();
    if (isValidEmail(email)) {
      // Check if email is already selected (either as database user or custom email)
      const isAlreadySelected = selectedUsers.some(user => user.email === email) ||
        selectedRecipients.some(recipient => recipient.email === email);

      if (!isAlreadySelected) {
        const customRecipient: Recipient = {
          id: email, // Use email as ID for custom emails
          email: email,
          name: 'Valued Customer',
          isCustomEmail: true
        };

        if (onRecipientsChange) {
          onRecipientsChange([...selectedRecipients, customRecipient]);
        }
        setSearchTerm('');
        setIsDropdownOpen(false);
      }
    }
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();

      // If dropdown is open and there are available users, select the first one
      if (isDropdownOpen && availableUsers.length > 0) {
        handleUserSelect(availableUsers[0]);
        return;
      }

      // If it looks like an email and custom emails are allowed, add as custom email
      if (allowCustomEmails && isValidEmail(searchTerm.trim())) {
        handleCustomEmailAdd();
      }
    }
  };

  // Handle user removal
  const handleUserRemove = (userId: number) => {
    onUsersChange(selectedUsers.filter(user => user.id !== userId));
  };

  // Handle recipient removal (for both database users and custom emails)
  const handleRecipientRemove = (recipientId: string) => {
    if (onRecipientsChange) {
      onRecipientsChange(selectedRecipients.filter(recipient => recipient.id !== recipientId));
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const container = target.closest('.simple-user-selector');
      if (!container) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen]);

  // Determine if we should show custom email option
  const showCustomEmailOption = allowCustomEmails &&
    searchTerm.trim() &&
    isValidEmail(searchTerm.trim()) &&
    !availableUsers.some(user => user.email === searchTerm.trim()) &&
    !selectedUsers.some(user => user.email === searchTerm.trim()) &&
    !selectedRecipients.some(recipient => recipient.email === searchTerm.trim());

  return (
    <div className={`relative simple-user-selector ${className}`}>
      {/* Selected Recipients Display */}
      {(selectedUsers.length > 0 || selectedRecipients.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-3">
          {/* Database Users */}
          {selectedUsers.map((user) => (
            <Badge
              key={user.id}
              variant="secondary"
              className="flex items-center gap-1 px-2 py-1"
            >
              <User className="w-3 h-3" />
              <span className="text-xs">{user.fullName}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleUserRemove(user.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))}

          {/* Custom Email Recipients */}
          {selectedRecipients.map((recipient) => (
            <Badge
              key={recipient.id}
              variant="outline"
              className="flex items-center gap-1 px-2 py-1 border-blue-200 bg-blue-50"
            >
              <Mail className="w-3 h-3 text-blue-600" />
              <span className="text-xs text-blue-700">{recipient.email}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                onClick={() => handleRecipientRemove(recipient.id)}
              >
                <X className="w-3 h-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyPress}
          placeholder={placeholder}
          className="pr-8"
          disabled={selectedUsers.length + selectedRecipients.length >= maxUsers}
        />
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="p-3 text-center text-gray-500">
              Loading users...
            </div>
          ) : (
            <>
              {/* Custom Email Option */}
              {showCustomEmailOption && (
                <div
                  className="p-3 cursor-pointer hover:bg-blue-50 border-b border-gray-100"
                  onClick={handleCustomEmailAdd}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                        <Mail className="w-4 h-4 text-blue-600" />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-blue-700 truncate">
                        Add custom email: {searchTerm}
                      </div>
                      <div className="text-sm text-blue-600">
                        Send to this email address
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Database Users */}
              {availableUsers.length === 0 ? (
                <div className="p-3 text-center text-gray-500">
                  {searchTerm ? 'No users found' : 'No users available'}
                </div>
              ) : (
                availableUsers.map((user) => (
                  <div
                    key={user.id}
                    className="p-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                    onClick={(e) => {
                      console.log('User clicked:', user, e);
                      e.stopPropagation();
                      handleUserSelect(user);
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {user.fullName}
                        </div>
                        <div className="text-sm text-gray-500 truncate">
                          {user.email}
                        </div>
                        <div className="text-xs text-gray-400 capitalize">
                          {user.role}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      )}

      {/* User count indicator */}
      {(selectedUsers.length > 0 || selectedRecipients.length > 0) && (
        <div className="text-xs text-gray-500 mt-1">
          {selectedUsers.length + selectedRecipients.length} of {maxUsers} recipients selected
        </div>
      )}
    </div>
  );
};