import React, { useEffect, useState } from 'react';

interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
  displayText: string;
}

interface SimpleUserSelectorProps {
  selectedUsers: User[];
  onUsersChange: (users: User[]) => void;
  placeholder?: string;
  maxUsers?: number;
  className?: string;
}

export const SimpleUserSelector: React.FC<SimpleUserSelectorProps> = ({
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

  // Fetch users from API
  const fetchUsers = async (search: string = '') => {
    setIsLoading(true);
    try {
      const url = search 
        ? `/api/get-users?search=${encodeURIComponent(search)}`
        : '/api/get-users';
      
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

  // Handle user selection
  const handleUserSelect = (user: User) => {
    if (selectedUsers.length < maxUsers) {
      onUsersChange([...selectedUsers, user]);
      setSearchTerm('');
      setIsDropdownOpen(false);
    }
  };

  // Handle user removal
  const handleUserRemove = (userId: number) => {
    onUsersChange(selectedUsers.filter(user => user.id !== userId));
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.user-selector-dropdown')) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen]);

  return (
    <div className={`relative ${className} user-selector-dropdown`}>
      {/* Selected Users Display */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedUsers.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-md text-xs"
            >
              <span>{user.fullName}</span>
              <button
                type="button"
                className="ml-1 text-blue-600 hover:text-blue-800"
                onClick={() => handleUserRemove(user.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          disabled={selectedUsers.length >= maxUsers}
        />
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
          {isLoading ? (
            <div className="p-3 text-center text-gray-500">
              Loading users...
            </div>
          ) : availableUsers.length === 0 ? (
            <div className="p-3 text-center text-gray-500">
              {searchTerm ? 'No users found' : 'No users available'}
            </div>
          ) : (
            availableUsers.map((user) => (
              <div
                key={user.id}
                className="p-3 cursor-pointer hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                onClick={() => handleUserSelect(user)}
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