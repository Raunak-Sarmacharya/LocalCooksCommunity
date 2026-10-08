import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { getAuthHeaders } from '@/lib/api';
import { useTourRequestAccess } from '@/hooks/use-tour-request-access';
import { useFirebaseAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatTourWhen } from '@/lib/chef-viewing-display';

type Permission = { id: number; grantedBy: number; reason: string; grantedAt: string; expiresAt: string;
  usedAt: string | null; usedByTourId: number | null; revokedAt: string | null; revokedBy: number | null; revokeReason: string | null };
type Context = { canGrant: boolean; updatedAt: string; grants: Permission[] };

export function AdminTourRepeatPermissionPanel({ id, version }: { id: number; version: string }) {
  const { t } = useTranslation('common');
  const { toast } = useToast();
  const client = useQueryClient();
  const [dialog, setDialog] = useState<{ grantId?: number; requestKey: string } | null>(null);
  const [reason, setReason] = useState('');
  const context = useQuery<Context>({ queryKey: ['/api/viewings/repeat-authorizations', id, version], queryFn: async () => {
    const response = await fetch(`/api/viewings/admin/${id}/repeat-authorizations`, { headers: await getAuthHeaders(), credentials: 'include' });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.grants)) throw new Error(body.error || t('tourPermissionLoadFailed', 'Could not check repeat tour permissions.'));
    return body;
  } });
  const save = useMutation({ mutationFn: async () => {
    if (!dialog || !context.data) throw new Error(t('tourPermissionLoadFailed', 'Could not check repeat tour permissions.'));
    const response = await fetch(`/api/viewings/admin/${id}/repeat-authorizations${dialog.grantId ? `/${dialog.grantId}/revoke` : ''}`, {
      method: 'POST', headers: await getAuthHeaders(), credentials: 'include',
      body: JSON.stringify({ reason: reason.trim(), requestKey: dialog.requestKey, expectedUpdatedAt: context.data.updatedAt }),
    });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || t('tourPermissionSaveFailed', 'Could not save the permission.'));
    return body;
  }, onSuccess: () => {
    setDialog(null); setReason('');
    void client.invalidateQueries({ queryKey: ['/api/viewings/repeat-authorizations'] });
    void client.invalidateQueries({ queryKey: ['/api/viewings/request-access'] });
    toast({ title: t('tourPermissionSaved', 'Tour permission saved') });
  }, onError: (error: Error) => {
    void context.refetch(); toast({ title: t('tourPermissionSaveFailed', 'Could not save the permission.'), description: error.message, variant: 'destructive' });
  } });
  const open = (grantId?: number) => { setReason(''); setDialog({ grantId, requestKey: crypto.randomUUID() }); };
  return <section className="space-y-3 rounded-xl border p-5 text-sm" aria-label={t('tourPermissionTitle', 'Repeat tour permission')}>
    <h3 className="font-semibold">{t('tourPermissionTitle', 'Repeat tour permission')}</h3>
    <p className="text-muted-foreground">{t('tourPermissionHelp', 'Local Cooks can permit one additional tour. The chef has 30 days to request it through the usual review process. Applicants and approved chefs remain ineligible.')}</p>
    {context.isLoading && <p role="status">{t('tourPermissionChecking', 'Checking permissions…')}</p>}
    {context.error && <div><p role="alert">{context.error.message}</p><Button variant="outline" onClick={() => void context.refetch()}>{t('retry', 'Retry')}</Button></div>}
    {context.data?.grants.map(grant => <div key={grant.id} className="space-y-2 border-t pt-3">
      <p className="font-medium">{grant.usedAt ? t('tourPermissionUsed', 'Used') : grant.revokedAt ? t('tourPermissionRevoked', 'Revoked')
        : Date.parse(grant.expiresAt) <= Date.now() ? t('tourPermissionExpired', 'Expired') : t('tourPermissionAvailable', 'Available')}</p>
      <p>{grant.reason}</p>
      <p className="text-xs text-muted-foreground">{t('tourPermissionGrantedBy', 'Granted by admin')} #{grant.grantedBy} · {formatTourWhen(grant.grantedAt, null, 'America/St_Johns')}</p>
      <p className="text-xs text-muted-foreground">{t('tourPermissionUseBefore', 'Request before')}: {formatTourWhen(grant.expiresAt, null, 'America/St_Johns')}</p>
      {grant.usedByTourId && <Link className="text-primary underline" href={`/admin?section=tour-requests&viewing=${grant.usedByTourId}`}>TOUR-{grant.usedByTourId}</Link>}
      {grant.revokedAt && <p>{t('tourPermissionRevoked', 'Revoked')} · #{grant.revokedBy} · {formatTourWhen(grant.revokedAt, null, 'America/St_Johns')} · {grant.revokeReason}</p>}
      {!grant.usedAt && !grant.revokedAt && Date.parse(grant.expiresAt) > Date.now() && <Button variant="outline" onClick={() => open(grant.id)}>{t('tourPermissionRevoke', 'Revoke unused permission')}</Button>}
    </div>)}
    {context.data?.canGrant && <Button variant="outline" onClick={() => open()}>{t('tourPermissionGrant', 'Allow another tour')}</Button>}
    <Dialog open={!!dialog} onOpenChange={value => !value && !save.isPending && setDialog(null)}>
      <DialogContent><DialogHeader><DialogTitle>{dialog?.grantId ? t('tourPermissionRevoke', 'Revoke unused permission') : t('tourPermissionGrant', 'Allow another tour')}</DialogTitle>
        <DialogDescription>{t('tourPermissionReasonHelp', 'Explain the decision. The reason and admin identity are saved in the admin audit record.')}</DialogDescription></DialogHeader>
        <Textarea aria-label={t('tourPermissionReason', 'Permission reason')} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} disabled={save.isPending} />
        <DialogFooter><Button variant="outline" disabled={save.isPending} onClick={() => setDialog(null)}>{t('cancel', 'Cancel')}</Button>
          <Button disabled={save.isPending || context.isFetching || reason.trim().length < 10} onClick={() => save.mutate()}>{save.isPending ? t('saving', 'Saving…') : t('tourPermissionSave', 'Save permission')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

export function ChefTourRepeatPermissionPanel({ kitchenId, locationId }: { kitchenId: number; locationId: number }) {
  const { user } = useFirebaseAuth();
  const { t } = useTranslation('kitchen');
  const access = useTourRequestAccess(kitchenId, user?.uid);
  if (!access.data?.canRequest) return null;
  return <section className="space-y-3 rounded-xl border p-5 text-sm" aria-label={t('tourRepeatRequest', 'Request another tour')}>
    <h3 className="font-semibold">{t('tourRepeatRequest', 'Request another tour')}</h3>
    <p>{access.data.authorization ? access.data.authorization.recovery
      ? t('tourRepeatRecovery', 'Your previous attempt could not take place. You can choose another time.')
      : t('tourRepeatAuthorized', 'Local Cooks has allowed another tour. Choose a time and send your request before the permission expires.')
      : t('tourRepeatRecovery', 'Your previous attempt could not take place. You can choose another time.')}</p>
    {access.data.authorization && !access.data.authorization.recovery && <p className="text-muted-foreground">{t('tourRepeatBefore', 'Request before')}: {formatTourWhen(access.data.authorization.expiresAt, null, 'America/St_Johns')}</p>}
    <Button asChild><Link href={`/request-tour/${locationId}?kitchenId=${kitchenId}`}>{t('tourRepeatRequest', 'Request another tour')}</Link></Button>
  </section>;
}
