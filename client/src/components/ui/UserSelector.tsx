import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, Mail, User, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  displayText: string;
}

interface UserSelectorProps {
  selectedUsers: User[];
  onUsersChange: (users: User[]) => void;
  placeholder?: string;
  maxUsers?: number;
  className?: string;
}

export const UserSelector: React.FC<UserSelectorProps> = ({
  selectedUsers,
  onUsersChange,
  placeholder = "Search users by name or email...",
  maxUsers = 10,
  className = ""
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    setHighlightedIndex(-1);
  };

  // Handle user selection
  const handleUserSelect = (user: User) => {
    if (selectedUsers.length < maxUsers) {
      onUsersChange([...selectedUsers, user]);
      setSearchTerm('');
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
      inputRef.current?.focus();
    }
  };

  // Handle user removal
  const handleUserRemove = (userId: number) => {
    onUsersChange(selectedUsers.filter(user => user.id !== userId));
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev < availableUsers.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev =>
          prev > 0 ? prev - 1 : availableUsers.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && availableUsers[highlightedIndex]) {
          handleUserSelect(availableUsers[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected Users Display */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
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
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="pr-8"
          disabled={selectedUsers.length >= maxUsers}
        />
        <ChevronDown
          className={`absolute right-2 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''
            }`}
        />
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 text-center text-gray-500">
              <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
              Loading users...
            </div>
          ) : availableUsers.length === 0 ? (
            <div className="p-3 text-center text-gray-500">
              {searchTerm ? 'No users found' : 'No users available'}
            </div>
          ) : (
            availableUsers.map((user, index) => (
              <div
                key={user.id}
                className={`p-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0 ${index === highlightedIndex ? 'bg-blue-50' : ''
                  }`}
                onClick={() => handleUserSelect(user)}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                      <User className="w-4 h-4 text-gray-600" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {user.fullName}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-gray-500 truncate">
                      <Mail className="w-3 h-3" />
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
        </div>
      )}

      {/* User count indicator */}
      {selectedUsers.length > 0 && (
        <div className="text-xs text-gray-500 mt-1">
          {selectedUsers.length} of {maxUsers} users selected
        </div>
      )}
    </div>
  );
};