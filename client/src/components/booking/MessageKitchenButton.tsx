import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Phone } from "lucide-react";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/** Opens the booking's chat with the kitchen (same entry as the booking page) and offers a call link when a phone is known. */
export function MessageKitchenButton({ bookingId, phone, label, link = false }: { bookingId: number; phone?: string | null; label?: string; link?: boolean }) {
  const { t } = useTranslation("chef");
  const [, navigate] = useLocation();
  const [opening, setOpening] = useState(false);
  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch(`/api/bookings/${bookingId}/conversation`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("kciMessageUnavailable", "Kitchen messaging is unavailable"));
      navigate(result.path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("kciMessageUnavailable", "Kitchen messaging is unavailable"));
    } finally { setOpening(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant={link ? "link" : "outline"} size="sm" className={link ? "h-auto p-0" : undefined} onClick={() => void open()} disabled={opening}>
        {opening ? t("kciMessageOpening", "Opening conversation…") : label ?? t("kciMessageKitchen", "Message kitchen")}
      </Button>
      {phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${phone}`}><Phone className="mr-1.5 h-3.5 w-3.5" aria-hidden />{t("kciCallKitchen", "Call kitchen")}</a></Button> : null}
    </div>
  );
}
