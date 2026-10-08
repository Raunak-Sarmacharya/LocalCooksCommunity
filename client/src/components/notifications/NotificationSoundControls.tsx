import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { useNotificationSound } from '@/hooks/use-notification-sound';

export function NotificationSoundControls({ sound }: { sound: ReturnType<typeof useNotificationSound> }) {
  const { t } = useTranslation('common');
  const descriptionId = useId();
  return (
    <div className="border-b px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {sound.enabled ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
          {t('notificationSoundLabel')}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {sound.enabled && sound.status !== 'unavailable' && (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={sound.test}>{t('notificationSoundTest')}</Button>
          )}
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled={sound.status === 'unavailable' && !sound.enabled}
            aria-describedby={descriptionId} onClick={() => sound.setEnabled(!sound.enabled)}>
            {t(sound.enabled ? 'notificationSoundMute' : 'notificationSoundEnable')}
          </Button>
        </div>
      </div>
      <p id={descriptionId} className="mt-1.5 text-xs leading-relaxed text-muted-foreground" role="status">
        {t(sound.status === 'unavailable' ? 'notificationSoundUnavailable' : sound.status === 'activation'
          ? 'notificationSoundActivation' : sound.enabled ? 'notificationSoundOnDescription' : 'notificationSoundOffDescription')}
      </p>
    </div>
  );
}
