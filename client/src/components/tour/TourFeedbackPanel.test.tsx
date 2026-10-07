import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TourFeedbackPanel } from './TourFeedbackPanel';
import locale from '../../../../shared/i18n/locales/en-CA/common.json';
vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { uid: 'fixture', getIdToken: async () => 'token' } } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => (locale as Record<string,string>)[key] || key }) }));
const clients:QueryClient[]=[];
const initial={ available:true,scheduledAt:'2026-10-05T12:00:00.000Z',appointmentRevision:2,response:null,chefSubmitted:false,managerSubmitted:false,conflict:false };
const answer={id:1,respondentRole:'chef',respondentId:7,happened:true,rating:4,comments:'Private chef details',suggestions:'Add a bench',scheduledAt:initial.scheduledAt,appointmentRevision:2};
function mount(role:'chef'|'manager'|'admin'='chef', data:any=initial, writeOk=true){
 let current=data;
 const fetcher=vi.fn(async (_url:string,options?:any)=>{if(options?.method==='POST'&&writeOk)current={...current,available:false,response:{...answer,...JSON.parse(options.body)}};return {ok:options?.method==='POST'?writeOk:true,json:async()=>current};});vi.stubGlobal('fetch',fetcher);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);
 const invalidation=vi.spyOn(client,'invalidateQueries');render(<QueryClientProvider client={client}><TourFeedbackPanel id={42} role={role} version="version" /></QueryClientProvider>);
 return {fetcher,client,invalidation};
}
afterEach(()=>{cleanup();clients.forEach(client=>client.clear());clients.length=0;vi.unstubAllGlobals();window.history.replaceState({},'','/');});
describe('private post-tour feedback',()=>{
 it('submits explicit participation, optional rating and private text against current appointment',async()=>{
  const{fetcher,invalidation}=mount();const save=await screen.findByRole('button',{name:'Submit private feedback'});expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('radio',{name:'Yes'}));fireEvent.change(screen.getByRole('combobox'),{target:{value:'4'}});
  fireEvent.change(screen.getByLabelText('Comments · optional'),{target:{value:'Useful visit'}});fireEvent.click(save);
  await screen.findByText('You reported that the tour took place.');
  const call=fetcher.mock.calls.find(([,options])=>options?.method==='POST')!;expect(call[0]).toBe('/api/viewings/chef/42/feedback');
  expect(JSON.parse(call[1].body)).toMatchObject({happened:true,rating:4,comments:'Useful visit',scheduledAt:initial.scheduledAt,appointmentRevision:2});
  expect(call[1]).toMatchObject({credentials:'include',headers:{Authorization:'Bearer token'}});
  const predicate=invalidation.mock.calls.find(([options])=>options?.predicate)?.[0]?.predicate!;
  for(const key of ['/api/viewings','managerViewings','/api/viewings/manager?locationId=4','/api/viewings/admin','/api/viewings/funnel'])expect(predicate({queryKey:[key]} as any)).toBe(true);
 });
 it('requires an explanation for a tour that did not happen and strips a previously chosen rating',async()=>{
  const{fetcher}=mount('manager');await screen.findByRole('radio',{name:'Yes'});fireEvent.click(screen.getByRole('radio',{name:'Yes'}));fireEvent.change(screen.getByRole('combobox'),{target:{value:'5'}});
  fireEvent.click(screen.getByRole('radio',{name:'No'}));expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  const save=screen.getByRole('button',{name:'Submit private feedback'});expect(save).toBeDisabled();fireEvent.change(screen.getByLabelText('Why did the tour not take place?'),{target:{value:'The kitchen was locked.'}});fireEvent.click(save);
  await screen.findByText('You reported that the tour did not take place.');const body=JSON.parse(fetcher.mock.calls.find(([,options])=>options?.method==='POST')![1].body);
  expect(body.happened).toBe(false);expect(body.reason).toBe('The kitchen was locked.');expect(body).not.toHaveProperty('rating');
 });
 it('keeps an immutable own response visible without any other participant text',async()=>{
  mount('chef',{...initial,available:false,response:answer,responses:[{...answer,respondentRole:'manager',comments:'DO NOT SHOW'}]});
  await screen.findByText('Private chef details');expect(screen.queryByText('DO NOT SHOW')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Submit private feedback'})).not.toBeInTheDocument();
 });
 it('shows both private responses and labels prior appointment and former manager evidence for admin only',async()=>{
  mount('admin',{...initial,available:false,conflict:true,chefSubmitted:true,managerSubmitted:true,responses:[answer,{...answer,id:2,respondentRole:'manager',respondentId:8,happened:false,reason:'Access unavailable',comments:'Private manager details'},{...answer,id:3,respondentRole:'manager',respondentId:8,currentAppointment:false,currentRespondent:false}]});
  await screen.findByText('Private manager details');expect(screen.getByText('Earlier appointment response')).toBeInTheDocument();expect(screen.getByText('Previous manager response')).toBeInTheDocument();
  expect(screen.getByText(/current chef and manager responses disagree/)).toBeInTheDocument();expect(screen.queryByRole('radio')).not.toBeInTheDocument();
 });
 it('does not post anything from a feedback deep link and focuses the panel',async()=>{
  window.history.replaceState({},'','/?feedback=1');const{fetcher}=mount();const region=await screen.findByRole('region',{name:'Tour feedback'});
  await waitFor(()=>expect(document.activeElement).toBe(region));expect(fetcher.mock.calls.every(([,options])=>!options?.method)).toBe(true);
 });
 it('does not focus a different tour in an admin list from a targeted feedback link',async()=>{
  window.history.replaceState({},'','/?viewing=99&feedback=1');mount('admin',{...initial,responses:[]});
  const region=await screen.findByRole('region',{name:'Tour feedback'});expect(document.activeElement).not.toBe(region);
 });
 it('retains editable input and reports a failed save instead of inventing a submission',async()=>{
  const{fetcher}=mount('chef',initial,false);await screen.findByRole('radio',{name:'Yes'});fireEvent.click(screen.getByRole('radio',{name:'Yes'}));fireEvent.click(screen.getByRole('button',{name:'Submit private feedback'}));
  await screen.findByRole('alert');expect(screen.getByRole('radio',{name:'Yes'})).toBeChecked();expect(fetcher.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);
 });
});
