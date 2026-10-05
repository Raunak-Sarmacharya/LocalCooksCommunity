import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingAttendancePanel } from './BookingAttendancePanel';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'fixture-token' } } }));
vi.mock('react-i18next', async () => {
  const labels = (await import('@shared/i18n/locales/en-CA/chef.json')).default as Record<string,string>;
  return { useTranslation: () => ({ t: (key: string) => labels[key] || key }) };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const record = { bookingId:10,status:'confirmed',checkinStatus:'not_checked_in',updatedAt:'2026-10-04T12:00:00Z',
  scheduledEnd:'2026-10-03T12:00:00Z',operationsComplete:true,assistanceHistory:[],
  visits:[{id:5,startTime:'09:00',endTime:'11:00',checkinStatus:'not_checked_in',updatedAt:'2026-10-04T12:00:00Z',scheduledEnd:'2026-10-03T12:00:00Z',operationsComplete:true}],history:[] };
function mount(manager:boolean, data:any=record) {
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>data})); vi.stubGlobal('fetch',fetcher);
  const onSaved=vi.fn(async()=>{});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><BookingAttendancePanel bookingId={10} manager={manager} onSaved={onSaved}/></QueryClientProvider>);
  return {client,fetcher,onSaved};
}
it('shows a compact read-only visit record to the chef with no routine forms', async()=>{
  const {client}=mount(false,{...record,history:[{id:1,visitId:5,action:'report_no_show',actorRole:'manager',sharedMessage:'Chef confirmed they could not attend',createdAt:'2026-10-04T12:00:00Z'}]});
  expect(await screen.findByText('Chef confirmed they could not attend',{exact:false})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Visit record'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Manage visit'})).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/Operations complete|Booking attendance/)).not.toBeInTheDocument(); client.clear();
});
it('opens manager exceptions on demand, selects a single visit automatically and can cancel without posting',async()=>{
  vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-04T12:00:00Z'));
  const {client,fetcher}=mount(true);
  fireEvent.click(await screen.findByRole('button',{name:'Manage visit'}));
  expect(screen.getByRole('dialog',{name:'Manage visit'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Report a no-show or correct a visit'}));
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Chef confirmed they could not attend'}});
  expect(screen.getByRole('button',{name:'Report chef no-show'})).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('button',{name:'Report chef no-show'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetcher.mock.calls.some(([,options]:any)=>options.method==='POST')).toBe(false); client.clear();
});
it('saves missed checkout through the existing assistance endpoint and returns to the visit record',async()=>{
  const {client,fetcher,onSaved}=mount(true);
  fireEvent.click(await screen.findByRole('button',{name:'Manage visit'}));
  fireEvent.click(screen.getByRole('button',{name:'Record missed check-in or checkout'}));
  fireEvent.change(screen.getByLabelText(/Actual reported/),{target:{value:'2026-10-03T11:00'}});
  fireEvent.change(screen.getByLabelText(/Reason and evidence/),{target:{value:'Chef confirmed departure after upload failed'}});
  fireEvent.click(screen.getByRole('button',{name:'Record assistance'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const post=fetcher.mock.calls.find(([,options]:any)=>options.method==='POST')!;
  expect(post[0]).toBe('/api/manager/bookings/10/assist-visit');
  expect(JSON.parse((post[1] as any).body)).toMatchObject({visitId:5,action:'departure',expectedUpdatedAt:record.visits[0].updatedAt}); client.clear();
});
it.each(['pending','cancelled'])('does not add visit controls to a %s booking without a recorded visit',async status=>{
  const {client}=mount(true,{...record,status});
  await waitFor(()=>expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('heading',{name:'Visit record'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Manage visit'})).not.toBeInTheDocument(); client.clear();
});
