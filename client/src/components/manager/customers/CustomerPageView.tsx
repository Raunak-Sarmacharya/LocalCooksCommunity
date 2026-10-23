import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { AlertCircle, Check, ChevronDown, ChevronLeft, ClipboardList, Copy, Mail, MapPin, MessageSquare, MoreHorizontal, Phone, Ban } from 'lucide-react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/booking-header-state';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { badge, btnPrimary, btnSecondary, card, cardBody, cardHead, cardMeta, cardTitle, focusRing, type BadgeTone } from '@/components/dashboard/dashboard-ui';
import { RevokeLocationAccessDialog } from '@/components/manager/applications/components/RevokeLocationAccessDialog';
import { DocumentViewerDialog } from '@/components/manager/applications/components/DocumentViewerDialog';
import { CustomerNotes } from './CustomerNotes';
import type { CustomerDocument, CustomerPageData, CustomerStatus } from './customer-types';
import { clockRange, customerHref, documentLabel, formatCalendarDay, formatDay, formatMoney, relativeDay, statusLabelKey } from './customer-format';
import { CustomersRequestError, resolveConversationId, useCustomerPage, useRevokeCustomerAccess } from './use-customers';
import { ActivityTab, BookingsTab, DocsTab, MoneyTab, OverviewTab, StorageTab, Facts, type TabKey } from './CustomerPageTabs';

const statusTone: Record<CustomerStatus, BadgeTone> = {
  approved: 'positive', in_review: 'attention', applied: 'neutral', suspended: 'attention', revoked: 'negative', former: 'neutral', prospect: 'neutral',
};
const TABS: TabKey[] = ['overview', 'bookings', 'storage', 'money', 'docs', 'activity'];
const BUSINESS_TYPES: Record<string, string> = { catering: 'cpBizCatering', bakery: 'cpBizBakery', 'meal-prep': 'cpBizMealPrep', specialty: 'cpBizSpecialty',
  pasta: 'cpBizPasta', sauce: 'cpBizSauce', prepared: 'cpBizPrepared', other: 'cpBizOther' };
const FREQUENCIES: Record<string, string> = { weekly: 'cpPlanWeekly', 'few-times-month': 'cpPlanFewTimesMonth', monthly: 'cpPlanMonthly', occasionally: 'cpPlanOccasionally', 'not-sure': 'cpPlanNotSure' };
const DURATIONS: Record<string, string> = { '2-4': 'cpPlan2to4', '4-8': 'cpPlan4to8', '8-12': 'cpPlan8to12', '12+': 'cpPlan12plus' };

/** "(709) 555-0100" for a North American number; anything else as entered. */
export function displayPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : phone;
}
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

function Card({ id, title, count, action, children, className }: { id: string; title: string; count?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(card, className)} aria-labelledby={id}>
      <div className={cardHead}>
        <h2 id={id} className={cn(cardTitle, 'min-w-0 truncate')}>{title}{count !== undefined && count !== '' && <span className={cardMeta}>{count}</span>}</h2>
        {action}
      </div>
      <div className={cardBody}>{children}</div>
    </section>
  );
}

export function CustomerPageView({ chefId, locationParam }: { chefId: number; locationParam: number | undefined }) {
  const query = useCustomerPage(chefId, locationParam, true);
  if (query.isPending) return <ProfileSkeleton />;
  if (query.isError || !query.data) {
    const missing = query.error instanceof CustomersRequestError && query.error.status === 404;
    return (
      <section role="alert" className={cn(card, 'mx-auto mt-10 max-w-[520px] p-7 text-center')}>
        <span className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-[#fef3f5] text-[#8f0a2b]"><AlertCircle className="size-5" aria-hidden /></span>
        <h1 className="text-xl font-semibold leading-7 tracking-[-0.02em] text-stone-900">{missing ? mt('cuPageNotFound') : mt('cpErrorTitle')}</h1>
        <p className="mx-auto mt-1.5 max-w-[44ch] text-sm text-stone-600">{missing ? mt('cuPageNotFoundHelp') : mt('cpErrorBody')}</p>
        <div className="mt-[18px] flex flex-wrap justify-center gap-2">
          {!missing && <button type="button" className={btnPrimary} onClick={() => void query.refetch()}>{mt('cuTryAgain')}</button>}
          <Link href="/manager/dashboard?view=customers" className={cn(btnSecondary, 'sm:h-9 sm:text-sm')}>{mt('cuBackToCustomers')}</Link>
        </div>
      </section>
    );
  }
  return <Profile data={query.data} />;
}

function Profile({ data }: { data: CustomerPageData }) {
  const locale = i18n.language || 'en-CA';
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const initialTab = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('tab') as TabKey | null;
  const [tab, setTab] = useState<TabKey>(initialTab && TABS.includes(initialTab) ? initialTab : 'overview');
  const [revoking, setRevoking] = useState(false);
  const [viewing, setViewing] = useState<CustomerDocument | null>(null);
  const [messageNote, setMessageNote] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const revoke = useRevokeCustomerAccess();
  const { customer, location, actions } = data;
  const name = customer.name, timezone = location.timezone;
  const go = (next: TabKey) => { setTab(next); window.scrollTo?.({ top: 0 }); };

  const openConversation = async () => {
    setMessageNote(''); setMessageBusy(true);
    try {
      const id = await resolveConversationId(customer.chefId, location.id);
      if (!id) setMessageNote(mt('cuMessageUnavailable', { name }));
      else navigate(`/manager/dashboard?view=messages&conversation=${encodeURIComponent(id)}&locationId=${location.id}`);
    } catch { setMessageNote(mt('cuMessageError')); } finally { setMessageBusy(false); }
  };
  const copy = async (value: string, done: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: done }); } catch { toast({ title: mt('cpCopyFailed') }); }
  };
  const inviteHref = `/manager/invitations/new?chefId=${customer.chefId}&location=${location.id}`;
  const applicationHref = actions.applicationId ? `/manager/dashboard?view=applications&application=${actions.applicationId}` : null;
  const typeLabel = customer.businessType ? BUSINESS_TYPES[customer.businessType] ? mt(BUSINESS_TYPES[customer.businessType]) : customer.businessType : null;
  const phone = customer.phone ? displayPhone(customer.phone) : null;
  const multi = data.locations.length > 1;

  return (
    <div className="min-w-0">
      <Link href="/manager/dashboard?view=customers" className={cn('-ml-1 mb-3 inline-flex h-10 items-center gap-1 text-[15px] font-medium text-stone-900 md:hidden', focusRing)}>
        <ChevronLeft className="size-5" aria-hidden />{mt('cuBreadcrumbCustomers')}
      </Link>

      <section aria-labelledby="customer-name" className="mb-4 grid grid-cols-[48px_minmax(0,1fr)] items-start gap-3 sm:mb-6 sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-4 lg:grid-cols-[56px_minmax(0,1fr)_auto]">
        <span aria-hidden className="grid size-12 place-items-center rounded-full bg-[#fde7ec] text-base font-semibold text-[#8f0a2b] sm:size-14 sm:text-lg">{initials(name)}</span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <h1 id="customer-name" className="min-w-0 truncate text-[22px] font-[650] leading-7 tracking-[-0.02em] text-stone-900 sm:text-[26px] sm:leading-8">{name}</h1>
            <span className={badge[statusTone[data.status]]}>{data.status === 'approved' && <i className="size-1.5 rounded-full bg-emerald-500" aria-hidden />}{mt(statusLabelKey[data.status])}</span>
          </div>
          {customer.businessName && (
            <p className="mt-0.5 text-sm text-stone-600"><span className="font-medium text-stone-900">{customer.businessName}</span>{typeLabel && ` · ${typeLabel}`}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-[18px] gap-y-1.5 text-sm sm:mt-2.5">
            {customer.email && <a href={`mailto:${customer.email}`} className={cn('hidden min-w-0 items-center gap-1.5 font-medium text-stone-900 hover:underline hover:decoration-stone-300 hover:underline-offset-[3px] sm:inline-flex', focusRing)}>
              <Mail className="size-4 shrink-0 text-stone-500" aria-hidden /><span className="truncate">{customer.email}</span></a>}
            {phone && <a href={telHref(customer.phone!)} className={cn('hidden items-center gap-1.5 whitespace-nowrap font-medium text-stone-900 hover:underline hover:decoration-stone-300 hover:underline-offset-[3px] sm:inline-flex', focusRing)}>
              <Phone className="size-4 shrink-0 text-stone-500" aria-hidden />{phone}</a>}
            {multi ? (
              <DropdownMenu>
                <DropdownMenuTrigger className={cn('-my-1 inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg bg-white px-2 font-medium text-stone-900 shadow-[0_1px_2px_rgba(28,25,23,.06)] ring-1 ring-inset ring-stone-300 hover:bg-stone-50 data-[state=open]:bg-stone-100', focusRing)}
                  aria-label={mt('cpSwitchLocation', { location: location.name })}>
                  <MapPin className="size-3.5 shrink-0 text-stone-500" aria-hidden /><span className="truncate">{location.name}</span>
                  <span className="font-normal text-stone-500">· {data.locations.length}</span><ChevronDown className="size-3.5 shrink-0 text-stone-500" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[min(300px,calc(100vw-32px))] rounded-[10px] p-1.5 shadow-[0_0_0_1px_#e7e5e4,0_8px_24px_rgba(28,25,23,.12)]">
                  <DropdownMenuLabel className="px-2.5 pb-1 pt-1.5 text-xs font-normal text-stone-500">{mt('cpHasAccessAt', { name })}</DropdownMenuLabel>
                  {data.locations.map(item => (
                    <DropdownMenuItem key={item.id} role="menuitemradio" aria-checked={item.id === location.id}
                      className={cn('grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 rounded-md px-2.5 py-2', item.id === location.id && 'bg-stone-100')}
                      onSelect={() => { if (item.id !== location.id) navigate(customerHref(customer.chefId, item.id)); }}>
                      <span className="row-span-2 mt-0.5 text-primary">{item.id === location.id && <Check className="size-4" aria-hidden />}</span>
                      <span className="truncate font-medium text-stone-900">{item.name}</span>
                      <span className="col-start-2 text-[13px] leading-[18px] text-stone-600">{mt(statusLabelKey[item.status])} · {mt('cpBookingCount', { count: item.bookingCount })}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-stone-600"><MapPin className="size-3.5 shrink-0 text-stone-500" aria-hidden /><span className="truncate">{location.name}</span></span>
            )}
          </div>
        </div>
        <div className="col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2 sm:flex sm:items-center lg:col-span-1 lg:pt-1">
          <button type="button" className={cn(btnPrimary, 'gap-1.5', !actions.canInvite && !actions.canReview && 'col-span-2')} onClick={() => void openConversation()} disabled={messageBusy}>
            <MessageSquare className="size-4" aria-hidden />{mt('cuActionMessage')}
          </button>
          {actions.canInvite && <Link href={inviteHref} className={cn(btnSecondary, 'h-11 text-sm sm:h-9')}>{mt('cuActionInvite')}</Link>}
          {!actions.canInvite && actions.canReview && applicationHref && <Link href={applicationHref} className={cn(btnSecondary, 'h-11 text-sm sm:h-9')}>{mt('cuActionReview')}</Link>}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(btnSecondary, 'h-11 w-11 flex-none px-0 sm:h-9 sm:w-9')} aria-label={mt('cpMoreActions')}><MoreHorizontal className="size-4" aria-hidden /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[236px] rounded-[10px] p-1.5 shadow-[0_0_0_1px_#e7e5e4,0_8px_24px_rgba(28,25,23,.12)]">
              {applicationHref && <DropdownMenuItem className="h-9 gap-2.5 px-2.5" onSelect={() => navigate(applicationHref)}><ClipboardList className="size-4 text-stone-500" aria-hidden />{mt('cpViewApplication')}</DropdownMenuItem>}
              {customer.email && <DropdownMenuItem className="h-9 gap-2.5 px-2.5" onSelect={() => void copy(customer.email!, mt('cpEmailCopied'))}><Copy className="size-4 text-stone-500" aria-hidden />{mt('cpCopyEmail')}</DropdownMenuItem>}
              {customer.phone && <DropdownMenuItem className="h-9 gap-2.5 px-2.5" onSelect={() => void copy(customer.phone!, mt('cpPhoneCopied'))}><Copy className="size-4 text-stone-500" aria-hidden />{mt('cpCopyPhone')}</DropdownMenuItem>}
              {actions.canRevoke && <>
                <DropdownMenuSeparator className="my-1.5 bg-stone-100" />
                <DropdownMenuItem className="h-9 gap-2.5 px-2.5 text-red-700 focus:bg-red-50 focus:text-red-700" onSelect={() => setRevoking(true)}><Ban className="size-4" aria-hidden />{mt('cpRevokeAccess')}</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      {messageNote && <p role="alert" className="-mt-2 mb-4 text-sm text-stone-600">{messageNote}</p>}
      {actions.revokedNote && (
        <p className="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm">
          {mt('cuRevokedNote', { location: location.name })}{' '}
          <a className="font-medium underline" href={`mailto:support@localcooks.ca?subject=${encodeURIComponent(`${name} · ${location.name}`)}`}>{mt('cuContactLocalCooks')}</a>
        </p>
      )}

      {(phone || customer.email) && (
        <div className={cn(card, 'mb-4 sm:hidden')}>
          {phone && <a href={telHref(customer.phone!)} className={cn('grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 px-4 text-[15px]', focusRing)}>
            <Phone className="size-4 text-stone-500" aria-hidden /><span className="truncate font-medium">{phone}</span><span className="text-[13px] text-stone-600">{mt('cpCall')}</span></a>}
          {customer.email && <a href={`mailto:${customer.email}`} className={cn('grid min-h-12 grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-[#f0eeec] px-4 text-[15px]', focusRing)}>
            <Mail className="size-4 text-stone-500" aria-hidden /><span className="truncate font-medium">{customer.email}</span><span className="text-[13px] text-stone-600">{mt('cpEmail')}</span></a>}
        </div>
      )}

      <Strip data={data} locale={locale} />

      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <Tabs value={tab} onValueChange={value => setTab(value as TabKey)} className="min-w-0">
          <TabsList aria-label={mt('cpSections')} className="-mx-4 mb-4 h-auto gap-[18px] rounded-none bg-transparent p-0 px-4 shadow-[inset_0_-1px_0_#e7e5e4] sm:mx-0 sm:mb-5 sm:gap-[22px] sm:px-0">
            {TABS.map(key => (
              <TabsTrigger key={key} value={key} className="relative h-10 flex-none rounded-none px-0 text-sm font-medium text-stone-600 shadow-none hover:text-stone-900 focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:text-stone-900 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-sm data-[state=active]:after:bg-primary">
                {mt(`cpTab_${key}`)}
                {key === 'bookings' && <span className="ml-1 font-normal text-stone-500">{data.bookingCounts.upcoming + data.bookingCounts.past + data.bookingCounts.cancelled}</span>}
                {key === 'storage' && data.storage.length > 0 && <span className="ml-1 font-normal text-stone-500">{data.storage.length}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="mt-0"><OverviewTab data={data} locale={locale} go={go} inviteHref={inviteHref} /></TabsContent>
          <TabsContent value="bookings" className="mt-0"><BookingsTab data={data} locale={locale} inviteHref={inviteHref} /></TabsContent>
          <TabsContent value="storage" className="mt-0"><StorageTab data={data} locale={locale} /></TabsContent>
          <TabsContent value="money" className="mt-0"><MoneyTab data={data} locale={locale} /></TabsContent>
          <TabsContent value="docs" className="mt-0"><DocsTab data={data} locale={locale} applicationHref={applicationHref} /></TabsContent>
          <TabsContent value="activity" className="mt-0"><ActivityTab data={data} locale={locale} /></TabsContent>
        </Tabs>

        <aside aria-label={mt('cpAboutThisCustomer')} className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <Card id="cp-access" title={mt('cpAccessAndDocuments')}>
            <div className="flex items-center justify-between gap-2 border-b border-[#f0eeec] pb-3">
              <span className={badge[statusTone[data.status]]}>{data.status === 'approved' && <i className="size-1.5 rounded-full bg-emerald-500" aria-hidden />}{mt(statusLabelKey[data.status])}</span>
              {(() => {
                const approved = data.application?.stages.find(stage => stage.key === 'youApproved')?.at;
                return approved ? <span className="text-[13px] text-stone-600">{mt('cpYouApprovedOn', { date: formatDay(approved, timezone, locale) })}</span> : null;
              })()}
            </div>
            {data.application?.documents.length ? data.application.documents.map(document => (
              <DocumentRow key={document.key} document={document} locale={locale} onView={() => setViewing(document)} />
            )) : <p className="pt-3 text-[13px] text-stone-600">{data.application ? mt('cpNoDocuments') : mt('cuNoApplication')}</p>}
          </Card>
          <Card id="cp-notes" title={mt('cuSecNotes')}>
            <CustomerNotes chefId={customer.chefId} locationId={location.id} name={name} timezone={timezone} />
          </Card>
          <Card id="cp-about" title={mt('cpAbout')}>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm sm:grid-cols-[112px_minmax(0,1fr)]">
              <dt className="text-[13px] leading-5 text-stone-600">{mt('cpAboutName')}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{name}</dd>
              {customer.businessName && <><dt className="text-[13px] leading-5 text-stone-600">{mt('cpAboutBusiness')}</dt>
                <dd className="min-w-0 [overflow-wrap:anywhere]">{customer.businessName}{typeLabel && <small className="block text-xs text-stone-500">{typeLabel}</small>}</dd></>}
              {phone && <><dt className="text-[13px] leading-5 text-stone-600">{mt('cpAboutPhone')}</dt>
                <dd className="min-w-0"><a href={telHref(customer.phone!)} className={cn('font-medium hover:underline', focusRing)}>{phone}</a></dd></>}
              {customer.usageFrequency && <><dt className="text-[13px] leading-5 text-stone-600">{mt('cpAboutPlans')}</dt>
                <dd className="min-w-0">{FREQUENCIES[customer.usageFrequency] ? mt(FREQUENCIES[customer.usageFrequency]) : customer.usageFrequency}
                  {customer.sessionDuration && <small className="block text-xs text-stone-500">{DURATIONS[customer.sessionDuration] ? mt(DURATIONS[customer.sessionDuration]) : customer.sessionDuration}</small>}</dd></>}
              {(customer.customerSince || customer.firstContactAt) && <><dt className="text-[13px] leading-5 text-stone-600">{mt(customer.customerSince ? 'cpAboutSince' : 'cpAboutFirstContact')}</dt>
                <dd className="min-w-0">{formatDay(customer.customerSince ?? customer.firstContactAt, timezone, locale)}
                  {customer.customerSince && customer.firstContactAt && <small className="block text-xs text-stone-500">{mt('cuFirstContact', { date: formatDay(customer.firstContactAt, timezone, locale) })}</small>}</dd></>}
            </dl>
          </Card>
        </aside>
      </div>

      {revoking && (
        <RevokeLocationAccessDialog customer={{ chefId: customer.chefId, locationId: location.id, fullName: name, location: { name: location.name } }}
          pending={revoke.isPending} onClose={() => setRevoking(false)}
          onConfirm={async reason => {
            await revoke.mutateAsync({ chefId: customer.chefId, locationId: location.id, reason });
            setRevoking(false);
            toast({ title: mt('cuRevokeDone', { location: location.name, name }) });
          }} />
      )}
      {data.application && (
        <DocumentViewerDialog applicationId={data.application.id} open={viewing !== null} onOpenChange={open => { if (!open) setViewing(null); }}
          title={viewing ? documentLabel(mt, viewing.key === 'foodEstablishmentCert' ? 'foodEstablishmentCert' : 'foodSafetyLicense') : ''}
          url={viewing?.url} status={viewing?.status as 'pending' | 'approved' | 'rejected' | undefined} expiry={viewing?.expiry}
          labels={{ verified: mt('verified'), pending: mt('pending'), rejected: mt('rejected'), needsReplacement: mt('needsAReplacement'), expired: mt('licenseExpired'),
            verify: mt('verifyDocument'), openInNewTab: mt('openInNewTab'), close: mt('close'), loading: mt('loadingDocument'), loadFailed: mt('documentUnavailable'),
            expires: mt('expiresLabel', { date: '{date}' }), working: mt('saving') }} />
      )}
    </div>
  );
}

/** Five figures about this customer at this location. Early cancellations are their right under the policy, so late ones lead. */
function Strip({ data, locale }: { data: CustomerPageData; locale: string }) {
  const { reliability: r, money, location } = data;
  const tz = location.timezone;
  const hours = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(r.hoursInKitchen);
  const perVisit = r.visits ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(r.hoursInKitchen / r.visits) : null;
  const net = money.paidCents - money.refundedCents;
  const figure = (key: string, label: string, value: ReactNode, caption: ReactNode, className?: string) => (
    <div key={key} className={cn('min-w-0 bg-white px-4 py-3 xl:px-5 xl:py-0', className)}>
      <div className="truncate text-[13px] text-stone-600">{label}</div>
      <div className="mt-0.5 whitespace-nowrap text-lg font-semibold leading-[26px] tracking-[-0.015em] tabular-nums text-stone-900 sm:text-[22px] sm:leading-[30px]">{value}</div>
      <div className="mt-0.5 text-xs leading-4 text-stone-500 xl:truncate">{caption}</div>
    </div>
  );
  const small = (text: string) => <small className="ml-0.5 text-[13px] font-medium tracking-normal text-stone-500 sm:text-sm">{text}</small>;
  const noShows = [mt('cpNoShows', { count: r.noShowsCounted }), r.noShowsUnderReview ? mt('cpNoShowsUnderReview', { count: r.noShowsUnderReview }) : null];
  return (
    <section aria-label={mt('cpRelationshipAt', { location: location.name })}
      className={cn(card, 'mb-4 grid grid-cols-2 gap-px overflow-hidden bg-[#f0eeec] sm:mb-5 md:grid-cols-3 xl:grid-cols-5 xl:bg-white xl:py-[18px] xl:[&>div+div]:border-l xl:[&>div+div]:border-[#f0eeec]')}>
      {figure('visits', mt('cpKpiVisits'), r.visits, r.lastVisitEndedAt ? mt('cpLastVisit', { day: relativeDay(mt, r.lastVisitEndedAt, tz, locale, new Date(), true) }) : mt('cpNoneYet'))}
      {figure('hours', mt('cpKpiHours'), <>{hours}{small(mt('cpHoursUnit'))}</>, perVisit ? mt('cpHoursPerVisit', { hours: perVisit }) : mt('cpAfterFirstVisit'))}
      {figure('net', mt('cpKpiNetPaid'), formatMoney(net, locale, money.currency), money.refundedCents ? mt('cpAfterRefunded', { amount: formatMoney(money.refundedCents, locale, money.currency) }) : money.paidCents ? mt('cpNoRefunds') : mt('cpNoPaymentsYet'))}
      {figure('next', mt('cpKpiNextVisit'), r.nextVisit ? relativeDay(mt, r.nextVisit.startsAt, tz, locale) : <span className="font-medium text-stone-500">{mt('cpNoneBooked')}</span>,
        r.nextVisit ? clockRange(r.nextVisit.startsAt, r.nextVisit.endsAt, tz, locale) : data.actions.canInvite ? mt('cpInviteThem') : '', 'order-first col-span-2 md:order-none md:col-span-1')}
      {figure('late', mt('cpKpiLate'), <>{r.lateCancellations}{small(mt('cpOfCancelled', { count: r.cancelledByCustomer }))}</>, <Facts items={noShows} />, 'md:col-span-2 xl:col-span-1')}
    </section>
  );
}

function DocumentRow({ document, locale, onView }: { document: CustomerDocument; locale: string; onView: () => void }) {
  const label = documentLabel(mt, document.key);
  const expired = document.daysLeft !== null && document.daysLeft <= 0;
  const status = !document.uploaded ? mt('cuDocNotUploaded') : expired ? mt('cuDocExpiredStatus')
    : document.status === 'approved' ? mt('cuDocVerified') : document.status === 'rejected' ? mt('cuDocRejected') : mt('cuDocPending');
  const ok = document.uploaded && !expired && document.status === 'approved';
  const expiry = !document.expiry ? mt('cuDocNoExpiry') : expired ? mt('cuDocExpiredOn', { date: formatCalendarDay(document.expiry, locale) })
    : mt('cpExpires', { date: formatCalendarDay(document.expiry, locale) });
  const warn = document.stage === 'expired' || document.stage === '3_day' ? 'font-medium text-red-700' : document.stage === '14_day' || document.stage === '45_day' ? 'font-medium text-amber-800' : '';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-[#f0eeec] py-[11px] [&+&]:border-t">
      <div className="min-w-0">
        <div className="font-medium text-stone-900">{label}</div>
        <div className="text-[13px] leading-[18px] text-stone-600">
          <span className={cn(ok && 'text-emerald-700', !ok && 'text-amber-800')}>{status}</span> · <span className={warn} data-expiry-stage={document.stage ?? 'ok'}>{expiry}</span>
        </div>
        {document.renewalPending && <div className="text-[13px] leading-[18px] text-stone-600">{mt('cuRenewalPending')}</div>}
      </div>
      {document.url && <button type="button" className={cn(btnSecondary, 'flex-none')} aria-label={mt('cuViewFileFor', { document: label })} onClick={onView}>{mt('cpView')}</button>}
    </div>
  );
}

function ProfileSkeleton() {
  const block = 'block rounded-md bg-[#efedeb] animate-pulse motion-reduce:animate-none';
  return (
    <div aria-busy="true" aria-label={mt('cuPageLoading')} className="min-w-0">
      <div className="mb-6 grid grid-cols-[48px_minmax(0,1fr)] gap-3 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:gap-4">
        <span className={cn(block, 'size-12 rounded-full sm:size-14')} />
        <div><span className={cn(block, 'mt-1 h-[26px] w-[220px] max-w-full')} /><span className={cn(block, 'mt-2.5 h-3 w-[180px]')} /><span className={cn(block, 'mt-4 h-3 w-[min(360px,100%)]')} /></div>
        <div className="col-span-2 flex gap-2 sm:col-span-1"><span className={cn(block, 'h-11 flex-1 rounded-lg sm:h-9 sm:w-[104px]')} /><span className={cn(block, 'h-11 flex-1 rounded-lg sm:h-9 sm:w-[120px]')} /><span className={cn(block, 'size-11 rounded-lg sm:size-9')} /></div>
      </div>
      <div className={cn(card, 'mb-5 grid grid-cols-2 gap-4 p-4 md:grid-cols-3 xl:grid-cols-5')}>
        {[0, 1, 2, 3, 4].map(index => <div key={index}><span className={cn(block, 'h-3 w-3/5')} /><span className={cn(block, 'mt-2.5 h-5 w-2/5')} /><span className={cn(block, 'mt-2.5 h-3 w-[70%]')} /></div>)}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div><div className="mb-5 flex h-10 items-center shadow-[inset_0_-1px_0_#e7e5e4]"><span className={cn(block, 'h-3.5 w-[min(480px,100%)]')} /></div>
          <div className={cn(card, 'p-5')}><span className={cn(block, 'mb-2 h-4 w-[180px]')} />{[55, 48, 60].map(width => <div key={width} className="border-t border-[#f0eeec] py-3.5 first-of-type:border-0"><span className={block} style={{ width: `${width}%`, height: 14 }} /><span className={cn(block, 'mt-2.5 h-3 w-1/3')} /></div>)}</div></div>
        <div className={cn(card, 'p-5')}><span className={cn(block, 'mb-2 h-4 w-[200px]')} />{[70, 65].map(width => <div key={width} className="py-3.5"><span className={block} style={{ width: `${width}%`, height: 14 }} /><span className={cn(block, 'mt-2.5 h-3 w-1/2')} /></div>)}</div>
      </div>
      <p className="sr-only" role="status">{mt('cuPageLoading')}</p>
    </div>
  );
}

export default CustomerPageView;
