import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ChevronRight, Search } from 'lucide-react';
import { mt } from '@/i18n/manager';
import i18n from '@/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { customerFilters, customerSorts, type CustomerFilter, type CustomerSort } from '@shared/customer-next-action';
import type { CustomerListRow } from './customer-types';
import { customerHref, formatDay, formatVisit, nextActionLine, statusLabelKey, statusVariant } from './customer-format';
import { useCustomerList, useCustomerUnread, type CustomerListParams } from './use-customers';
import { AddCustomer } from './AddCustomer';

const filterLabel: Record<CustomerFilter, string> = {
  all: 'cuFilterAll', needs_action: 'cuFilterNeedsAction', applied: 'cuStatusApplied', in_review: 'cuStatusInReview', approved: 'cuStatusApproved',
  suspended: 'cuStatusSuspended', revoked: 'cuStatusRevoked', former: 'cuStatusFormer', prospect: 'cuStatusProspect',
};
const emptyKey: Record<Exclude<CustomerFilter, 'all'>, string> = {
  needs_action: 'cuEmptyNeedsAction', applied: 'cuEmptyApplied', in_review: 'cuEmptyInReview', approved: 'cuEmptyApproved', suspended: 'cuEmptySuspended',
  revoked: 'cuEmptyRevoked', former: 'cuEmptyFormer', prospect: 'cuEmptyProspect',
};
const sortLabel: Record<CustomerSort, string> = { needs_action: 'cuSortNeeds', deadline: 'cuSortDeadline', next_booking: 'cuSortNextBooking', name: 'cuSortName' };

type Scope = { id: number; name: string };

/** List state lives in the URL so Back from a customer page returns to the same view. */
function readUrl(defaultLocation: string): CustomerListParams & { pages: number } {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('status') as CustomerFilter | null;
  const sort = params.get('sort') as CustomerSort | null;
  const pages = Number(params.get('pages'));
  return {
    location: params.get('location') || defaultLocation,
    status: status && customerFilters.includes(status) ? status : 'all',
    sort: sort && customerSorts.includes(sort) ? sort : 'needs_action',
    q: params.get('q') ?? '',
    pages: Number.isInteger(pages) && pages > 1 && pages <= 20 ? pages : 1,
  };
}
function writeUrl(state: CustomerListParams & { pages: number }, defaultLocation: string) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string | null) => { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); };
  set('status', state.status === 'all' ? null : state.status);
  set('sort', state.sort === 'needs_action' ? null : state.sort);
  set('q', state.q.trim() || null);
  set('location', state.location === defaultLocation ? null : state.location);
  set('pages', state.pages > 1 ? String(state.pages) : null);
  url.searchParams.delete('cursor');
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

export function CustomersList({ locations, selectedLocationId }: { locations: Scope[]; selectedLocationId: number | null }) {
  const locale = i18n.language || 'en-CA';
  const defaultLocation = selectedLocationId ? String(selectedLocationId) : 'all';
  const initial = useMemo(() => readUrl(defaultLocation), [defaultLocation]);
  const [state, setState] = useState<CustomerListParams>({ location: initial.location, status: initial.status, sort: initial.sort, q: initial.q });
  // "Add customer" (owner, Oct 24) is its own page inside Customers; ?add=1 keeps Back and refresh on it.
  const [adding, setAdding] = useState(() => new URLSearchParams(window.location.search).get('add') === '1');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const openAdd = (open: boolean) => {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set('add', '1'); else url.searchParams.delete('add');
    window.history.pushState({}, '', url);
    setAdding(open);
  };
  useEffect(() => {
    const sync = () => setAdding(new URLSearchParams(window.location.search).get('add') === '1');
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  // Until the manager picks a location here, the list follows the dashboard's own selection as it loads.
  const pickedLocation = useRef(new URLSearchParams(window.location.search).has('location'));
  useEffect(() => { if (!pickedLocation.current) setState(current => current.location === defaultLocation ? current : { ...current, location: defaultLocation }); }, [defaultLocation]);
  const [search, setSearch] = useState(initial.q);
  const [wantedPages, setWantedPages] = useState(initial.pages);
  // The search box updates as you type; the list follows once typing pauses.
  useEffect(() => {
    const handle = window.setTimeout(() => setState(current => current.q === search ? current : { ...current, q: search }), 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  const query = useCustomerList(state);
  const unread = useCustomerUnread();
  const pages = query.data?.pages ?? [];
  const loadedPages = pages.length;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;

  // Back restores "Load more": re-fetch as many pages as the URL says were showing.
  useEffect(() => {
    if (query.isSuccess && loadedPages < wantedPages && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [query.isSuccess, loadedPages, wantedPages, hasNextPage, isFetchingNextPage, fetchNextPage]);
  useEffect(() => { writeUrl({ ...state, pages: Math.max(loadedPages, 1) }, defaultLocation); }, [state, loadedPages, defaultLocation]);

  const rows = pages.flatMap(page => page.customers);
  const counts = pages[0]?.counts;
  const scopeLocation = state.location === 'all' ? null : locations.find(location => String(location.id) === state.location) ?? null;
  const change = (patch: Partial<CustomerListParams>) => {
    if (patch.location) pickedLocation.current = true;
    setWantedPages(1);
    setState(current => ({ ...current, ...patch }));
  };
  const showLocations = state.location === 'all' && locations.length > 1;
  if (adding) return <AddCustomer locations={locations} defaultLocationId={scopeLocation?.id ?? selectedLocationId}
    onDone={sent => { openAdd(false); setSentTo(sent); }} />;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight md:hidden">{mt('cuTitle')}</h2>
          <p className="text-muted-foreground">{scopeLocation ? mt('cuIntro', { location: scopeLocation.name }) : mt('cuIntroAll')}</p>
        </div>
        <Button type="button" onClick={() => openAdd(true)}>{mt('acTitleShort')}</Button>
      </header>
      {sentTo && (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <span>{mt('acSent', { email: sentTo })}</span>
          <Link href="/manager/dashboard?view=applications" className="font-medium underline underline-offset-4">{mt('acSeeInvites')}</Link>
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="customers-search">{mt('cuSearchLabel')}</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="customers-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={mt('cuSearchPlaceholder')}
              className="h-11 pl-9" autoComplete="off" maxLength={120} />
          </div>
        </div>
        {locations.length > 1 && (
          <div className="space-y-1.5">
            <Label htmlFor="customers-location">{mt('cuLocationLabel')}</Label>
            <Select value={state.location} onValueChange={location => change({ location })}>
              <SelectTrigger id="customers-location" className="h-11 w-full md:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{mt('cuAllLocations')}</SelectItem>
                {locations.map(location => <SelectItem key={location.id} value={String(location.id)}>{location.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="customers-sort">{mt('cuSortLabel')}</Label>
          <Select value={state.sort} onValueChange={sort => change({ sort: sort as CustomerSort })}>
            <SelectTrigger id="customers-sort" className="h-11 w-full md:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>{customerSorts.map(sort => <SelectItem key={sort} value={sort}>{mt(sortLabel[sort])}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div role="group" aria-label={mt('cuFiltersLabel')} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {customerFilters.filter(filter => filter !== 'suspended' || (counts?.suspended ?? 0) > 0 || state.status === 'suspended').map(filter => {
          const active = state.status === filter;
          return (
            <button key={filter} type="button" aria-pressed={active} onClick={() => change({ status: filter })}
              className={cn('inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                active ? 'border-primary bg-primary/10 font-medium text-foreground' : 'bg-background hover:bg-muted')}>
              {mt('cuFilterChip', { label: mt(filterLabel[filter]), count: counts ? counts[filter] : '…' })}
            </button>
          );
        })}
      </div>

      {query.isPending ? (
        <div role="status" aria-label={mt('cuLoadingList')} className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 w-full rounded-xl" />)}
        </div>
      ) : query.isError ? (
        <div role="alert" className="space-y-3 rounded-xl border p-4">
          <p>{mt('cuLoadError')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>{mt('cuTryAgain')}</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed p-6 text-center">
          <p>{state.q.trim() ? mt('cuEmptySearch', { query: state.q.trim() })
            : state.status !== 'all' ? mt(emptyKey[state.status])
            : scopeLocation ? mt('cuEmptyLocation', { location: scopeLocation.name }) : mt('cuEmptyAll')}</p>
          {state.q.trim() && <Button variant="outline" onClick={() => { setSearch(''); change({ q: '' }); }}>{mt('cuClearSearch')}</Button>}
        </div>
      ) : (
        <>
          <div className="hidden grid-cols-[minmax(0,2fr)_auto_minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,1fr)] gap-4 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid" aria-hidden>
            <span>{mt('cuColName')}</span><span className="w-28">{mt('cuColStatus')}</span><span>{mt('cuColNext')}</span><span>{mt('cuColNextBooking')}</span><span>{mt('cuColOpen')}</span>
          </div>
          <ul className="space-y-2" aria-label={mt('cuTitle')}>
            {rows.map(row => <CustomerRow key={row.chefId} row={row} locale={locale} showLocations={showLocations} unread={unreadFor(row, unread.data)} />)}
          </ul>
          {hasNextPage && (
            <div className="flex justify-center">
              <Button variant="outline" className="min-h-11" disabled={isFetchingNextPage}
                onClick={() => { setWantedPages(loadedPages + 1); void fetchNextPage(); }}>{mt('cuLoadMore')}</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function unreadFor(row: CustomerListRow, unread: Map<string, number> | undefined) {
  if (!unread) return 0;
  return row.locations.reduce((total, chip) => total + (unread.get(`${row.chefId}:${chip.locationId}`) ?? 0), 0);
}

function CustomerRow({ row, locale, showLocations, unread }: { row: CustomerListRow; locale: string; showLocations: boolean; unread: number }) {
  const open = row.openItems + unread;
  return (
    <li>
      <Link href={customerHref(row.chefId, row.locationId)}
        className="group flex flex-col gap-1.5 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:grid md:grid-cols-[minmax(0,2fr)_auto_minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,1fr)] md:items-start md:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {row.needsAction && <><span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden /><span className="sr-only">{mt('cuNeedsActionMark')}</span></>}
            <span className="truncate font-medium">{row.name}</span>
          </div>
          {row.businessName && <p className="truncate text-sm text-muted-foreground">{row.businessName}</p>}
        </div>
        <div className="flex w-28 flex-wrap gap-1 md:flex-col">
          {showLocations && row.locations.length > 0
            ? row.locations.map(chip => <Badge key={chip.locationId} variant={statusVariant[chip.status]} className="max-w-full whitespace-normal">{mt('cuAccessChip', { status: mt(statusLabelKey[chip.status]), location: chip.locationName })}</Badge>)
            : <Badge variant={statusVariant[row.status]}>{mt(row.status === 'applied' && row.addedByKitchen ? 'cuStatusAdded' : statusLabelKey[row.status])}</Badge>}
        </div>
        <p className={cn('text-sm', row.next.owner === 'nobody' && 'text-muted-foreground')}>{nextActionLine(mt, row.next, row.name, row.timezone, locale)}</p>
        <p className="text-sm text-muted-foreground">
          {row.nextBooking ? formatVisit(row.nextBooking.startsAt, row.nextBooking.endsAt, row.nextBooking.timezone, locale) : mt('cuNoNextBooking')}
        </p>
        <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground md:block">
          <div>
            {open > 0 ? <span className="font-medium text-foreground">{mt('cuOpenItems', { count: open })}</span> : <span>{mt('cuNoValue')}</span>}
            {row.lastActivityAt && <p className="hidden text-xs md:block"><span className="sr-only">{mt('cuColLast')}: </span>{formatDay(row.lastActivityAt, row.timezone, locale)}</p>}
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 md:hidden" aria-hidden />
        </div>
      </Link>
    </li>
  );
}

export default CustomersList;
