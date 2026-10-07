import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminTourVisitEvidence } from './AdminTourVisitEvidence';
vi.mock('@/lib/firebase',()=>({ auth:{ currentUser:{ getIdToken:async()=> 'token' } } }));
vi.mock('react-i18next',()=>({ useTranslation:()=>({ t:(key:string,fallback?:any)=>typeof fallback==='string'?fallback:key }) }));
vi.mock('@/components/ui/date-field',()=>({ DateField:({ id,value,onChange }:any)=><input id={id} value={value} onChange={e=>onChange(e.target.value)} /> }));
const clients:QueryClient[]=[];
afterEach(()=>{cleanup(); clients.forEach(client=>client.clear());clients.length=0;vi.unstubAllGlobals();});
it('requires explicit verified/unknown decisions and an explanation before repairing admin evidence',async()=>{
  const data={tour:{updatedAt:'2026-10-01T10:00:00Z',scheduledAt:'2026-10-05T12:10:00Z',visitEvidenceState:'review',confirmationVerified:true},events:[]};
  const fetcher=vi.fn(async(_url:any,options?:any)=>({ ok:true,json:async()=> options?.method==='POST'?{}:data }));vi.stubGlobal('fetch',fetcher);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
  render(<QueryClientProvider client={client}><AdminTourVisitEvidence id={10} version={data.tour.updatedAt} needsReview /></QueryClientProvider>);
  const save=await screen.findByRole('button',{name:'tourVisitSaveRepair'});expect(save).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox',{name:'tourVisitArrival'}),{target:{value:'unknown'}});
  fireEvent.change(screen.getByRole('combobox',{name:'tourVisitDeparture'}),{target:{value:'unknown'}});
  expect(save).toBeDisabled();fireEvent.change(screen.getByLabelText('tourVisitWhatHappened'),{target:{value:'Original records conflict and no reliable times can be verified.'}});
  fireEvent.click(save);
  await waitFor(()=>expect(fetcher.mock.calls.some(([,options])=>options?.method==='POST')).toBe(true));
  const call=fetcher.mock.calls.find(([,options])=>options?.method==='POST')!;
  expect(call[0]).toBe('/api/viewings/admin/10/evidence-repair');
  expect(JSON.parse(call[1].body)).toMatchObject({arrival:null,departure:null,confirmationVerified:true,expectedUpdatedAt:data.tour.updatedAt,scheduledAt:data.tour.scheduledAt});
});
it('loads admin investigation records only when opened',()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const client=new QueryClient();clients.push(client);
  render(<QueryClientProvider client={client}><AdminTourVisitEvidence id={10} version="version" /></QueryClientProvider>);
  expect(fetcher).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'tourVisitAdminEvidence'})).toHaveAttribute('aria-expanded','false');
});
