import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { afterEach,expect,it,vi } from 'vitest';
import ChefViewingsList from './chef/ChefViewingsList';
import { ViewingsDashboard } from './manager/ViewingsDashboard';
import { tourNextAction } from '@/lib/manager-overview-lifecycle';
vi.mock('@/lib/firebase',()=>({auth:{currentUser:{uid:'fixture',getIdToken:async()=> 'token'}}}));
vi.mock('@/hooks/use-auth',()=>({useFirebaseAuth:()=>({user:{uid:'fixture-chef'}})}));
vi.mock('react-i18next',async original=>({...await original<typeof import('react-i18next')>(),useTranslation:()=>({t:(key:string,fallback?:any)=>typeof fallback==='string'?fallback:key,i18n:{language:'en-CA'}})}));
vi.mock('@/i18n/manager',()=>({mt:(key:string)=>key}));
vi.mock('@/components/ui/data-table',()=>({DataTable:({data,onRowClick}:any)=><button onClick={()=>onRowClick(data[0])}>Open tour</button>}));
vi.mock('@/components/chat/TourChatButton',()=>({TourChatButton:()=>null}));
const clients:QueryClient[]=[];
afterEach(()=>{cleanup();clients.forEach(client=>client.clear());clients.length=0;vi.unstubAllGlobals();window.history.replaceState({},'','/');});
const tour={id:42,chefId:8,locationId:33,targetedKitchenId:40,status:'confirmed',confirmationVerified:true,scheduledAt:'2026-10-05T12:00:00.000Z',updatedAt:'2026-10-05T10:00:00.000Z',durationMinutes:30};
function mount(role:'chef'|'manager',future=false){
 const record={viewing:{...tour,...(future?{scheduledAt:'2099-10-05T12:00:00.000Z'}:{})},locationName:'Fixture kitchen'};
 const feedback={available:!future,scheduledAt:record.viewing.scheduledAt,appointmentRevision:1,response:null,chefSubmitted:false,managerSubmitted:false,conflict:false};
 const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>url.endsWith('/feedback')?feedback:url.endsWith('/history')?{events:[],complete:true}:url.includes('/application-next-step')?{action:'apply',href:'/apply-kitchen/33?tourId=42'}:url.endsWith('/chef')?[record]:{problems:[],reportingAvailable:false}}));vi.stubGlobal('fetch',fetcher);
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});clients.push(client);
 if(role==='manager')client.setQueryData(['/api/viewings/manager'],[record]);else window.history.replaceState({},'','/dashboard?view=viewings&viewing=42&feedback=1');
 render(<QueryClientProvider client={client}>{role==='chef'?<ChefViewingsList />:<ViewingsDashboard />}</QueryClientProvider>);
 if(role==='manager')fireEvent.click(screen.getByRole('button',{name:'Open tour'}));return {fetcher,client};
}
it.each(['chef','manager'] as const)('shows private feedback after the appointment for %s and no attendance controls',async role=>{
 const{fetcher}=mount(role);await screen.findByRole('radio',{name:'yes'});
 expect(screen.getByRole('region',{name:'tourFeedbackTitle'})).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:/Record arrival|Record departure|markCompleted|markNoShow/})).not.toBeInTheDocument();
 expect(fetcher.mock.calls.every(([url])=>!url.includes('attendance')&&!url.includes('check-in')&&!url.includes('check-out'))).toBe(true);
 expect(fetcher.mock.calls.every(([,options])=>!(options as any)?.method || (options as any).method === 'GET')).toBe(true);
});
it.each(['chef','manager'] as const)('offers no feedback or attendance actions before tour end for %s',async role=>{
 mount(role,true);await screen.findByText('Fixture kitchen');expect(screen.queryByRole('region',{name:'tourFeedbackTitle'})).not.toBeInTheDocument();
});
it('stops the manager feedback task after own immutable submission',()=>{
 expect(tourNextAction(tour,Date.parse('2026-10-05T13:00:00Z'))).toBe('overviewTourFeedback');
 expect(tourNextAction({...tour,managerFeedbackSubmitted:true},Date.parse('2026-10-05T13:00:00Z'))).toBeNull();
});
