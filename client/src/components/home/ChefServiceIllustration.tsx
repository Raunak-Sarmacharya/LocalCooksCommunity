import { CalendarDays, Check, Clock3, CreditCard, MapPin, Menu, ShoppingBag, Star, Store, TrendingUp, Truck } from "lucide-react";
import { SiStripe } from "react-icons/si";
import harbourKitchenImage from "@/assets/harbour-kitchen-hub.jpg";

export function ChefServiceIllustration({ variant }: { variant: "storefront" | "operations" | "kitchen" }) {
  if (variant === "storefront") {
    return (
      <div className="relative mx-auto h-52 w-full max-w-[280px] pointer-events-none select-none" aria-label="Illustration of a chef storefront on the LocalCooks marketplace">
        {/* Main Storefront Card */}
        <div className="absolute inset-x-2 top-2 overflow-hidden rounded-2xl border-[4px] border-white bg-white text-left shadow-[0_18px_38px_-24px_rgba(45,28,25,.4)] z-0">
          <div className="relative flex h-24 items-end p-3 overflow-hidden">
            <img src="https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=300&fit=crop" alt="Storefront cover" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="relative w-full">
              <p className="text-sm font-bold text-white drop-shadow-md">Spice & Spoon</p>
              <p className="text-[8px] text-white/90">Authentic homemade comfort food</p>
            </div>
          </div>
          <div className="p-3 bg-white pb-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[.12em] text-[#F51042]"><Store className="h-3 w-3" /> Chef storefront</span>
              <span className="rounded-full bg-[#F51042]/10 px-2 py-1 text-[8px] font-bold text-[#F51042]">Accepting orders</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Meal boxes", "Baked goods", "Vegetarian"].map((item) => (
                <span key={item} className="rounded-full border border-slate-200 px-2 py-0.5 text-[7px] font-medium text-slate-600">{item}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Floating Top Right: Rating */}
        <div className="absolute -right-2 top-8 flex items-center gap-1 rounded-full border border-[#F51042]/20 bg-white px-2.5 py-1.5 shadow-[0_8px_20px_-12px_rgba(15,23,42,.2)] z-20">
          <Star className="h-2.5 w-2.5 fill-[#F51042] text-[#F51042]" />
          <span className="text-[9px] font-bold text-slate-800">5.0</span>
          <span className="text-[7px] text-slate-500">(124)</span>
        </div>

        {/* Floating Bottom Left: Menu Item Mock */}
        <div className="absolute -bottom-2 -left-3 flex w-[65%] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 text-left shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)] z-20">
          <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-xl">
             <img src="https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=100&h=100&fit=crop" className="h-full w-full object-cover" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[9px] font-bold text-slate-800">Truffle Pasta</span>
            <span className="block text-[8px] font-bold text-[#F51042]">$18.00</span>
          </div>
          <div className="flex h-5 w-5 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#F51042] text-white hover:bg-[#E00A38] transition-colors">+</div>
        </div>

        {/* Floating Bottom Right: Live indicator */}
        <div className="absolute bottom-8 -right-1 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-lg z-10">
          <div className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#F51042]/75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#F51042]"></span>
          </div>
          <span className="text-[8px] font-bold text-slate-700">6 Active orders</span>
        </div>
      </div>
    );
  }

  if (variant === "operations") {
    return (
      <div className="relative mx-auto h-52 w-full max-w-[280px] pointer-events-none select-none" aria-label="LocalCooks handling an order, delivery, and payment">
        {/* Main Chart Card */}
        <div className="absolute inset-x-2 top-2 rounded-2xl border border-slate-100 bg-white p-3.5 text-left shadow-[0_18px_38px_-24px_rgba(15,80,76,.15)] z-0">
          <div className="flex items-center justify-between mb-2">
            <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.13em] text-slate-500">
              <TrendingUp className="h-3 w-3" /> Revenue
            </span>
            <span className="rounded-full bg-[#F51042]/10 px-2 py-1 text-[8px] font-bold text-[#F51042]">+14% this week</span>
          </div>
          <p className="text-sm font-bold text-slate-900">$1,842.50</p>
          <div className="mt-3 flex h-12 items-end justify-between gap-[3px]">
            {[35, 50, 30, 65, 100, 75, 90].map((h, i) => (
              <div key={i} className="w-full flex items-end h-full rounded-[2px] bg-slate-50">
                <div 
                  className={`w-full rounded-[2px] transition-all duration-500 ${i === 4 ? 'bg-[#F51042]' : 'bg-slate-200 hover:bg-slate-300'}`} 
                  style={{ height: `${h}%` }} 
                />
              </div>
            ))}
          </div>
        </div>

        {/* 1. New Order (top left overlapping) */}
        <div className="absolute -left-3 top-20 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-left shadow-[0_12px_24px_-12px_rgba(15,23,42,.2)] z-20">
          <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-[#F51042]/10 text-[#F51042]"><ShoppingBag className="h-3 w-3" /></span>
          <span className="pr-1"><span className="block text-[8px] font-bold text-slate-800">New Order</span><span className="block text-[7px] font-bold text-[#F51042]">+$48.00</span></span>
        </div>

        {/* 2. Delivery Handled (bottom left) */}
        <div className="absolute bottom-2 left-0 flex w-[54%] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)] z-10">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#F51042]/10 text-[#F51042]"><Truck className="h-3.5 w-3.5" /></span>
          <span className="min-w-0"><span className="block truncate text-[9px] font-bold text-slate-800">Delivery</span><span className="block truncate text-[8px] text-slate-500">Driver assigned</span></span>
        </div>

        {/* 3. Stripe Payout (bottom right) */}
        <div className="absolute bottom-7 right-0 flex w-[52%] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 text-left shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)] z-20">
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl bg-[#635BFF]/10 text-[#635BFF]">
            <SiStripe className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[9px] font-bold text-slate-800">Stripe payout</span>
            <span className="block truncate text-[8px] font-bold text-[#F51042]">+$428.50</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-52 w-full max-w-[280px] pointer-events-none select-none" aria-label="A commercial kitchen booking through LocalCooks">
      {/* Main Kitchen Card */}
      <div className="absolute inset-x-2 top-2 overflow-hidden rounded-2xl border border-[#F51042]/10 bg-white text-left shadow-[0_18px_38px_-24px_rgba(245,16,66,.2)] z-0">
        <div className="relative flex h-24 items-center justify-center overflow-hidden">
          <img src={harbourKitchenImage} alt="Commercial Kitchen" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute bottom-2 left-2 flex gap-1">
             <span className="rounded bg-black/50 px-1.5 py-0.5 backdrop-blur-sm text-[7px] text-white">Ovens</span>
             <span className="rounded bg-black/50 px-1.5 py-0.5 backdrop-blur-sm text-[7px] text-white">Mixers</span>
             <span className="rounded bg-black/50 px-1.5 py-0.5 backdrop-blur-sm text-[7px] text-white">Cold Storage</span>
          </div>
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <span>
              <span className="block text-sm font-bold text-slate-900">The Culinary Hub</span>
              <span className="mt-1 flex items-center gap-1 text-[8px] font-medium text-slate-500"><MapPin className="h-2.5 w-2.5" /> St. John’s, NL</span>
            </span>
            <div className="text-right">
              <span className="block text-[10px] font-bold text-[#F51042]">$24<span className="text-[8px] font-normal text-[#F51042]">/hr</span></span>
              <span className="block text-[8px] text-slate-500">or $180/day</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Top Right: Verified Badge */}
      <div className="absolute -right-2 top-6 flex items-center gap-1.5 rounded-full border border-[#F51042]/20 bg-white px-2 py-1 shadow-[0_8px_20px_-12px_rgba(15,23,42,.2)] z-20">
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#F51042] text-white"><Check className="h-2.5 w-2.5" /></span>
        <span className="text-[8px] font-bold text-[#F51042] pr-1">Licensed Kitchen</span>
      </div>

      {/* Floating Bottom Left: Selected Booking Time */}
      <div className="absolute bottom-11 -left-2 flex w-[60%] items-center justify-between rounded-2xl border border-slate-200 bg-white px-2.5 py-2 shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)] z-10">
        <div className="flex items-center gap-1.5">
          <div className="flex h-7 w-7 flex-col items-center justify-center rounded-md bg-[#F51042]/10 text-[#F51042]">
            <span className="text-[6px] font-bold uppercase leading-tight">Sep</span>
            <span className="text-[10px] font-bold leading-tight">17</span>
          </div>
          <div>
            <span className="block text-[9px] font-bold text-slate-800">Prep Session</span>
            <span className="flex items-center gap-0.5 text-[7px] text-slate-500"><Clock3 className="h-2.5 w-2.5" /> 10:00 AM - 2:00 PM</span>
          </div>
        </div>
      </div>

      {/* Floating Bottom Right / Action Bar */}
      <div className="absolute bottom-2 inset-x-0 mx-auto flex w-[90%] items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)] z-20">
        <div className="flex-1 cursor-pointer rounded-xl bg-[#F51042] py-2 text-center text-[9px] font-bold text-white shadow-sm hover:bg-[#E00A38] transition-colors">Book Kitchen</div>
        <div className="flex-1 cursor-pointer rounded-xl border border-slate-200 bg-slate-50 py-2 text-center text-[9px] font-bold text-slate-700 hover:bg-slate-100 transition-colors">Request Tour</div>
      </div>
    </div>
  );
}
