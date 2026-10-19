import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare as ChefMessage } from 'lucide-react';
import { MessageSquare as ManagerMessage } from '@/components/ui/manager-icons';
import { Button } from '@/components/ui/button';
import { getAuthHeaders } from '@/lib/api';
import { navigateNotificationHref } from '@/lib/navigate-notification-href';

export function StorageMessageButton({ rentalId, chef }: { rentalId: number; chef?: string }) {
  const { t } = useTranslation('storage');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const Icon = chef ? ManagerMessage : ChefMessage;
  async function openConversation() {
    setPending(true); setFailed(false);
    try {
      const response = await fetch(`/api/storage-rentals/${rentalId}/conversation`, { method: 'POST', credentials: 'include', headers: await getAuthHeaders() });
      if (!response.ok) throw Error();
      const result = await response.json();
      navigateNotificationHref(result.path);
    } catch { setFailed(true); } finally { setPending(false); }
  }
  return <div>
    <Button variant="outline" className="min-h-11" disabled={pending} onClick={() => void openConversation()}><Icon className="mr-2 h-4 w-4" />{chef ? t('stMessageChef', { chef }) : t('stMessageKitchen')}</Button>
    {failed && <p role="alert" className="mt-2 text-sm text-destructive">{t('stMessageFailed')}</p>}
  </div>;
}
