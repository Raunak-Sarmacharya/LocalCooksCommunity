import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageExtensionDialog } from './StorageExtensionDialog';
vi.mock('@/lib/api',()=>({getAuthHeaders:async()=>({'Content-Type':'application/json',Authorization:'Bearer fixture'})}));
vi.mock('@/hooks/use-unpaid-penalties',()=>({useUnpaidPenaltiesCheck:()=>({data:{hasUnpaidPenalties:false}})}));
vi.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const booking={id:30,storageListingId:5,startDate:'2099-10-01T12:00:00Z',endDate:'2099-10-04T12:00:00Z',status:'confirmed',totalPrice:1000,serviceFee:0,storageName:'Fixture shelf',storageType:'dry',kitchenName:'Fixture kitchen',basePrice:1000,minimumBookingDuration:2};
it('retains the selected date and blocks payment after the authoritative preview rejects it',async()=>{
  const fetcher=vi.fn(async()=>({ok:false,json:async()=>({error:'This storage booking was already cleared'})}));vi.stubGlobal('fetch',fetcher);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><StorageExtensionDialog booking={booking} open onOpenChange={()=>{}} /></QueryClientProvider>);
  fireEvent.click(screen.getByText('sx1Week'));
  expect(await screen.findByText('This storage booking was already cleared')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'sxSelectDuration'})).toBeDisabled();
  expect(fetcher.mock.calls.every(([path]:any)=>path.endsWith('/extension-preview'))).toBe(true);client.clear();
});
it('requires a current server preview before enabling extension payment',async()=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
  const fetcher=vi.fn(async()=>{await gate;return{ok:true,json:async()=>({extensionDays:7,extensionBasePrice:70,extensionTax:10.5,extensionTotalPrice:80.5,taxRatePercent:15})};});vi.stubGlobal('fetch',fetcher);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><StorageExtensionDialog booking={booking} open onOpenChange={()=>{}} /></QueryClientProvider>);
  fireEvent.click(screen.getByText('sx1Week'));
  expect(screen.getByRole('button',{name:'sxSelectDuration'})).toBeDisabled();release();
  await waitFor(()=>expect(screen.getByRole('button',{name:'sxPayAmount'})).toBeEnabled());
  expect(fetcher.mock.calls.every(([path]:any)=>path.endsWith('/extension-preview'))).toBe(true);client.clear();
});
