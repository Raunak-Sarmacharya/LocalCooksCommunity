import { beforeEach, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({ booking:{} as any,extension:null as any, get:vi.fn(),pending:vi.fn(),extend:vi.fn() }));
vi.mock('../db',()=>({pool:{},db:{select:()=>{
  const chain:any={from:()=>chain,where:()=>chain,limit:()=>Promise.resolve([])};return chain;
}}}));
vi.mock('../domains/bookings/booking.service',()=>({bookingService:{getStorageBookingById:state.get,getPendingStorageExtension:state.pending,extendStorageBooking:state.extend}}));
vi.mock('../firebase-auth-middleware',()=>({requireFirebaseAuthWithUser:vi.fn(),hasVerifiedEmail:()=>true}));
vi.mock('./middleware',()=>({requireChef:vi.fn(),requireNoUnpaidPenalties:vi.fn()}));
vi.mock('../r2-storage',()=>({getPresignedUrl:vi.fn()}));
vi.mock('../email',()=>({sendEmail:vi.fn()}));
import router from './bookings';
const handler=(path:string,method:string)=>(router as any).stack.find((entry:any)=>entry.route?.path===path&&entry.route.methods[method]).route.stack.at(-1).handle;
async function call(body:any,kind='preview',chef=3){const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
  await handler(`/chef/storage-bookings/:id/${kind==='legacy'?'extend':`extension-${kind}`}`,kind==='legacy'?'put':'post')({params:{id:'30'},neonUser:{id:chef},body},res);return res;}
beforeEach(()=>{vi.clearAllMocks();state.booking={id:30,chefId:3,status:'confirmed',endDate:'2099-10-04T12:00:00Z',minimumBookingDuration:2,basePrice:1000};
  state.get.mockImplementation(async()=>state.booking);state.pending.mockImplementation(async()=>state.extension);state.extension=null;});
it('rejects foreign customer preview and checkout before creating a payment',async()=>{
  for(const kind of ['preview','checkout'])expect((await call({newEndDate:'2099-10-07'},kind,99)).status).toHaveBeenCalledWith(403);
  expect(state.extend).not.toHaveBeenCalled();
});
it('revalidates minimum duration and terminal state in both preview and authoritative checkout',async()=>{
  for(const kind of ['preview','checkout']){
    expect((await call({newEndDate:'2099-10-05T12:00:00Z'},kind)).status).toHaveBeenCalledWith(400);
    state.booking.status='completed';expect((await call({newEndDate:'2099-10-08'},kind)).status).toHaveBeenCalledWith(400);state.booking.status='confirmed';
  }
  expect(state.extend).not.toHaveBeenCalled();
});
it('rejects stale no-longer-extending selection when the current end has moved',async()=>{
  state.booking.endDate='2099-10-10T12:00:00Z';
  expect((await call({newEndDate:'2099-10-07'},'checkout')).status).toHaveBeenCalledWith(400);expect(state.extend).not.toHaveBeenCalled();
});
it('legacy payment flags cannot extend or rewrite historical financial terms',async()=>{
  expect((await call({newEndDate:'2099-10-07',paymentConfirmed:true},'legacy')).status).toHaveBeenCalledWith(402);
  state.extension={status:'completed',newEndDate:new Date('2099-10-08')};
  expect((await call({newEndDate:'2099-10-07',paymentConfirmed:true,stripeSessionId:'fixture'},'legacy')).status).toHaveBeenCalledWith(409);
  expect(state.extend).not.toHaveBeenCalled();
});
it('repeated completed-extension compatibility reads never apply another extension or price change',async()=>{
  state.booking.endDate='2099-10-07T12:00:00Z';state.extension={status:'completed',newEndDate:new Date(state.booking.endDate)};
  for(let i=0;i<2;i++)expect((await call({newEndDate:state.booking.endDate,paymentConfirmed:true,stripeSessionId:'fixture'},'legacy')).json).toHaveBeenCalledWith(expect.objectContaining({booking:state.booking}));
  expect(state.extend).not.toHaveBeenCalled();
});
