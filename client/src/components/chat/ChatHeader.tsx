interface ChatHeaderProps {
  locationName?: string;
  onClose?: () => void;
  embedded?: boolean;
  showLocation?: boolean;
}

export default function ChatHeader({ locationName, embedded = false, showLocation = false }: ChatHeaderProps) {
  if (embedded) {
    // Don't show location in embedded view - it's already shown on the message tab
    return null;
  }

  if (!showLocation || !locationName) {
    return null;
  }

  return (
    <div className="text-sm text-gray-600">
      Application for {locationName}
    </div>
  );
}
