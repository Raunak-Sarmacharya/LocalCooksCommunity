import { useMemo, useSyncExternalStore } from 'react';
import { NotificationSound } from '@/lib/notification-sound';

const inactiveSubscribe = () => () => {};

export function useNotificationSound(role: 'chef' | 'manager', uid: string | undefined, active = true) {
  const controller = useMemo(() => new NotificationSound(`${role}:${encodeURIComponent(uid ?? 'signed-out')}`), [role, uid]);
  const state = useSyncExternalStore(active && uid ? controller.subscribe : inactiveSubscribe, controller.getSnapshot, controller.getSnapshot);
  return { ...state, setEnabled: controller.setEnabled, test: controller.test, observe: controller.observe };
}
