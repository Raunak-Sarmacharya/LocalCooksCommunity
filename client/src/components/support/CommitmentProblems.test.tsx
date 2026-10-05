import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { CommitmentProblems } from './CommitmentProblems';
vi.mock('@/lib/api', () => ({ getAuthHeaders: async () => ({ Authorization:'Bearer fixture-token','Content-Type':'application/json' }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const problem = { id:4,bookingId:null,viewingId:20,kind:'live',status:'reported',claimedBy:null,revision:1,
  description:'Cannot enter the kitchen for our confirmed tour',history:[{ revision:1,at:'2026-10-04T12:00:00Z',actorId:3,action:'report',note:'Awaiting first response from Local Cooks' }] };
function mount(props: any, fetcher: any) {
  vi.stubGlobal('fetch',fetcher);
  const client=new QueryClient({ defaultOptions:{ queries:{retry:false},mutations:{retry:false} } });
  render(<QueryClientProvider client={client}><CommitmentProblems {...props} /></QueryClientProvider>);
  return client;
}
it('saves a tracked live report with authentication and retains the retry key after failure', async () => {
  const fetcher=vi.fn(async (_path:string,options:any) => ({ ok:options.method==='GET',json:async () => options.method==='GET'?{problems:[],reportingAvailable:true}:{error:'Temporary failure; retry'} }));
  const client=mount({kind:'tour',id:20,canReport:true},fetcher);
  fireEvent.click(await screen.findByRole('button',{name:'Report a problem'}));
  fireEvent.change(await screen.findByRole('textbox'),{target:{value:'Cannot enter the scheduled kitchen'}});
  fireEvent.click(screen.getByRole('button',{name:'Send report'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary failure');
  expect(screen.getByRole('textbox')).toHaveValue('Cannot enter the scheduled kitchen');
  fireEvent.click(screen.getByRole('button',{name:'Send report'}));
  await waitFor(() => expect(fetcher.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(2));
  const posts=fetcher.mock.calls.filter(([,options])=>options.method==='POST');
  expect(posts[0][0]).toBe('/api/commitment-problems/tour/20');
  expect(posts[0][1].headers.Authorization).toBe('Bearer fixture-token');
  expect(JSON.parse(posts[0][1].body).requestKey).toBe(JSON.parse(posts[1][1].body).requestKey);
  expect(screen.getByText(/Mon–Fri, 9 AM–5 PM NL time/)).toBeInTheDocument(); client.clear();
});
it('shows an open request to the manager without staff ownership language or resolution actions',async () => {
  const client=mount({role:'manager'},vi.fn(async()=>({ok:true,json:async()=>[{...problem,status:'acknowledged',claimedBy:1}]})));
  expect(await screen.findByText(/Request #4/)).toHaveTextContent('In progress');
  expect(screen.getByText(/Your request is still open/)).toBeInTheDocument();
  expect(screen.queryByText(/owns|first response|staff #/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Resolve request'})).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Open current tour'})).toHaveAttribute('href','/manager/dashboard?view=viewings&viewing=20'); client.clear();
});
it('connects the admin queue claim to its current persisted revision',async () => {
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>[problem]}));
  const client=mount({staff:true,role:'admin'},fetcher);
  fireEvent.click(await screen.findByRole('button',{name:'Assign to me'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([,options]:any)=>options.method==='PATCH')).toBe(true));
  const patch=fetcher.mock.calls.find(([,options]:any)=>options.method==='PATCH') as any;
  expect(patch[0]).toBe('/api/commitment-problems/4');
  expect(JSON.parse(patch[1].body)).toMatchObject({action:'claim',expectedRevision:1}); client.clear();
});

it.each(['booking','tour'] as const)('keeps %s help discoverable without an empty problems banner or open form', async kind => {
  const client=mount({kind,id:20,canReport:true},vi.fn(async()=>({ok:true,json:async()=>({problems:[],reportingAvailable:true})})));
  expect(await screen.findByRole('button',{name:'Report a problem'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:`Need help with this ${kind}?`})).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/No tracked problems|owns the first response|Booking and tour problems/)).not.toBeInTheDocument(); client.clear();
});

it.each(['reported','acknowledged','escalated','resolved'])('shows existing %s reports even when new reporting is unavailable', async status => {
  const client=mount({kind:'tour',id:20,canReport:true},vi.fn(async()=>({ok:true,json:async()=>({problems:[{...problem,status}],reportingAvailable:false})})));
  expect(await screen.findByText(/Request #4/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Report a problem'})).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'support@localcook.shop'})).toBeInTheDocument();
  expect(!!screen.queryByText(/Your request is still open|Your report has been received/)).toBe(status!=='resolved'); client.clear();
});

it('does not offer another staff member response controls before takeover', async () => {
  const client=mount({staff:true,role:'admin'},vi.fn(async()=>({ok:true,json:async()=>({problems:[{...problem,status:'acknowledged',claimedBy:1}],reportingAvailable:false,actorId:2})})));
  expect(await screen.findByRole('button',{name:'Assign to me with reason'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Resolve request'})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Taking over the customer response'}});
  expect(screen.getByRole('button',{name:'Assign to me with reason'})).toBeEnabled(); client.clear();
});

it('only the assigned staff member gets resolution controls and resolved requests have none', async () => {
  const client=mount({staff:true,role:'admin'},vi.fn(async()=>({ok:true,json:async()=>({problems:[{...problem,status:'acknowledged',claimedBy:1},{...problem,id:5,status:'resolved',claimedBy:1}],reportingAvailable:false,actorId:1})})));
  expect(await screen.findByRole('button',{name:'Resolve request'})).toBeDisabled();
  expect(screen.getAllByRole('textbox')).toHaveLength(1); client.clear();
});

it('resets the report draft when the selected tour changes',async () => {
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({problems:[],reportingAvailable:true})}));
  vi.stubGlobal('fetch',fetcher);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=(id:number)=><QueryClientProvider client={client}><CommitmentProblems kind="tour" id={id} canReport /></QueryClientProvider>;
  const rendered=render(view(20));
  fireEvent.click(await screen.findByRole('button',{name:'Report a problem'}));
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Draft belongs to tour twenty'}});
  rendered.rerender(view(21));
  fireEvent.click(await screen.findByRole('button',{name:'Report a problem'}));
  expect(screen.getByRole('textbox')).toHaveValue(''); client.clear();
});

it('lets current server eligibility enable reporting without reopening the parent tour',async () => {
  let available=false;
  const client=mount({kind:'tour',id:20,canReport:true},vi.fn(async()=>({ok:true,json:async()=>({problems:[],reportingAvailable:available})})));
  await screen.findByRole('heading',{name:'Need help with this tour?'});
  await waitFor(()=>expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('button',{name:'Report a problem'})).not.toBeInTheDocument();
  available=true;
  await client.invalidateQueries({queryKey:['commitment-problems']});
  expect(await screen.findByRole('button',{name:'Report a problem'})).toBeInTheDocument(); client.clear();
});

it.each(['booking','tour'] as const)('explains when %s reporting opens while retaining support and existing replies', async kind => {
  const client=mount({kind,id:20,canReport:true},vi.fn(async()=>({ok:true,json:async()=>({problems:[problem],reportingAvailable:false,reportingOpensAt:'2026-10-05T12:00:00Z'})})));
  expect(await screen.findByText(/Reporting opens at the scheduled start\./)).toHaveTextContent('Contact support if you need help before then.');
  expect(screen.queryByRole('button',{name:'Report a problem'})).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'support@localcook.shop'})).toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Add a reply'})).toBeInTheDocument(); client.clear();
});

it('adds a participant reply to the existing request and retains text after a failed send', async () => {
  const fetcher=vi.fn(async(_path:string,options:any)=>({ok:options.method==='GET',json:async()=>options.method==='GET'?{problems:[problem],reportingAvailable:true}:{error:'Temporary reply failure'}}));
  const client=mount({kind:'tour',id:20,canReport:true},fetcher);
  const reply=await screen.findByRole('textbox',{name:'Add a reply'});
  fireEvent.change(reply,{target:{value:'More details for this same request'}});
  fireEvent.click(screen.getByRole('button',{name:'Send reply'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Temporary reply failure');
  expect(reply).toHaveValue('More details for this same request');
  const patch=fetcher.mock.calls.find(([,options]:any)=>options.method==='PATCH') as any;
  expect(patch[0]).toBe('/api/commitment-problems/4');
  expect(JSON.parse(patch[1].body)).toMatchObject({action:'reply',expectedRevision:1});
  expect(fetcher.mock.calls.some(([,options]:any)=>options.method==='POST')).toBe(false); client.clear();
});
it('offers retry when current problem state cannot load',async () => {
  const fetcher=vi.fn(async()=>({ok:false,json:async()=>({error:'Schema release prerequisite missing'})}));
  const client=mount({},fetcher);
  expect(await screen.findByRole('alert')).toHaveTextContent('Schema release prerequisite missing');
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2)); client.clear();
});

it('can cancel or escape the report dialog and reopen its unsent draft without a request', async () => {
  const fetcher=vi.fn(async()=>({ok:true,json:async()=>({problems:[],reportingAvailable:true})}));
  const client=mount({kind:'tour',id:20,canReport:true},fetcher);
  fireEvent.click(await screen.findByRole('button',{name:'Report a problem'}));
  expect(screen.getByRole('dialog',{name:'Report a problem'})).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Unsent kitchen access question'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button',{name:'Report a problem'}));
  expect(screen.getByRole('textbox')).toHaveValue('Unsent kitchen access question');
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape',code:'Escape'});
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetcher.mock.calls.some(([,options]:any)=>options.method==='POST')).toBe(false); client.clear();
});

it('closes a successful report and shows its persisted public trail to chef and manager', async () => {
  let sent=false;
  const fetcher=vi.fn(async(_path:string,options:any)=>({ok:true,json:async()=> {
    if(options.method==='POST') { sent=true; return problem; }
    return {problems:sent?[{...problem,history:[...problem.history,{revision:2,at:'2026-10-04T12:01:00Z',actorId:1,actorRole:'admin',action:'claim',note:'Private assignment'},{revision:3,at:'2026-10-04T12:02:00Z',actorId:1,actorRole:'admin',action:'reply',note:'Support is arranging access'}]}]:[],reportingAvailable:true};
  }}));
  const client=mount({kind:'tour',id:20,canReport:true},fetcher);
  fireEvent.click(await screen.findByRole('button',{name:'Report a problem'}));
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Cannot enter the scheduled kitchen'}});
  fireEvent.click(screen.getByRole('button',{name:'Send report'}));
  expect(await screen.findByText(/Report received. Follow its progress below/)).toBeInTheDocument();
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await screen.findByText(/Request #4/)).toBeInTheDocument();
  expect(screen.getByText(/Latest update: Support is arranging access/)).toBeInTheDocument();
  expect(screen.getByText('Response history')).toBeInTheDocument();
  expect(screen.queryByText('Private assignment')).not.toBeInTheDocument(); client.clear();
});
