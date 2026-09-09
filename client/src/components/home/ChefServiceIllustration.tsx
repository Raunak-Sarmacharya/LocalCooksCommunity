import { CalendarDays, Check, ChefHat, Clock3, CreditCard, MapPin, Menu, PackageCheck, ShoppingBag, Store, Truck } from "lucide-react";

export function ChefServiceIllustration({ variant }: { variant: "storefront" | "operations" | "kitchen" }) {
  if (variant === "storefront") {
    return (
      <div className="relative mx-auto h-44 w-full max-w-[290px]" aria-label="Illustration of a chef storefront on the LocalCooks marketplace">
        <div className="absolute inset-x-0 top-1 overflow-hidden rounded-2xl border-[5px] border-white bg-white text-left shadow-[0_20px_42px_-24px_rgba(45,28,25,.55)]">
          <div className="relative flex h-20 items-end bg-gradient-to-br from-amber-100 via-orange-100 to-rose-200 p-3">
            <div className="absolute right-3 top-3 flex gap-1.5"><span className="h-7 w-7 rounded-full bg-amber-300/70" /><span className="h-7 w-7 rounded-full bg-rose-300/70" /><span className="h-7 w-7 rounded-full bg-orange-300/70" /></div>
            <p className="relative text-sm font-bold text-slate-900">Harbour Spoon</p>
          </div>
          <div className="p-3">
            <div className="flex items-center justify-between"><span className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-[.12em] text-[#F51042]"><Store className="h-3 w-3" /> Chef storefront</span><span className="rounded-full bg-amber-50 px-2 py-1 text-[8px] font-bold text-amber-700">Pre-order</span></div>
            <div className="mt-2 flex gap-1.5">{["Meal boxes", "Baked goods", "Vegetarian"].map((item) => <span key={item} className="rounded-full border border-slate-200 px-2 py-1 text-[7px] font-medium text-slate-600">{item}</span>)}</div>
          </div>
        </div>
        <div className="absolute bottom-0 right-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-lg"><Menu className="h-3.5 w-3.5 text-[#F51042]" /><span className="text-[8px] font-bold text-slate-700">6 menu items live</span></div>
      </div>
    );
  }

  if (variant === "operations") {
    return (
      <div className="relative mx-auto h-44 w-full max-w-[270px]" aria-label="LocalCooks handling an order, delivery, and payment">
        <div className="absolute inset-x-3 top-1 rounded-2xl border border-teal-100 bg-white p-3 text-left shadow-[0_18px_38px_-24px_rgba(15,80,76,.4)]">
          <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[.13em] text-teal-700"><ShoppingBag className="h-3.5 w-3.5" /> New order</span><span className="rounded-full bg-teal-50 px-2 py-1 text-[8px] font-bold text-teal-700">Confirmed</span></div>
          <p className="mt-2 text-xs font-bold text-slate-900">2 items · $38.50</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 rounded-full bg-teal-500" /></div>
        </div>
        <div className="absolute bottom-1 left-0 flex w-[54%] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)]"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Truck className="h-4 w-4" /></span><span><span className="block text-[9px] font-bold text-slate-800">Delivery handled</span><span className="block text-[8px] text-slate-500">Driver assigned</span></span></div>
        <div className="absolute bottom-3 right-0 flex w-[49%] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)]"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CreditCard className="h-4 w-4" /></span><span><span className="block text-[9px] font-bold text-slate-800">Payment secured</span><span className="block text-[8px] text-emerald-700">Payout ready</span></span></div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto h-44 w-full max-w-[270px]" aria-label="A commercial kitchen booking through LocalCooks">
      <div className="absolute inset-x-3 top-0 overflow-hidden rounded-2xl border border-amber-100 bg-white text-left shadow-[0_18px_38px_-24px_rgba(90,58,12,.4)]">
        <div className="flex h-16 items-center justify-center bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100"><ChefHat className="h-8 w-8 text-amber-700" /></div>
        <div className="p-3"><div className="flex items-start justify-between gap-2"><span><span className="block text-xs font-bold text-slate-900">Harbour Kitchen Hub</span><span className="mt-1 flex items-center gap-1 text-[8px] text-slate-500"><MapPin className="h-2.5 w-2.5" /> St. John’s</span></span><span className="rounded-full bg-amber-50 px-2 py-1 text-[8px] font-bold text-amber-700">$24/hr</span></div></div>
      </div>
      <div className="absolute bottom-0 left-0 right-0 mx-auto flex w-[86%] items-center justify-between rounded-2xl border border-slate-200 bg-white px-3 py-2.5 shadow-[0_16px_34px_-22px_rgba(15,23,42,.42)]">
        <span className="flex items-center gap-1 text-[8px] font-semibold text-slate-600"><CalendarDays className="h-3 w-3 text-[#F51042]" /> Sep 17</span>
        <span className="flex items-center gap-1 text-[8px] font-semibold text-slate-600"><Clock3 className="h-3 w-3 text-[#F51042]" /> 10–12</span>
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-3 w-3" /></span>
      </div>
    </div>
  );
}
