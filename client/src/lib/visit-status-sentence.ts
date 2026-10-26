import { collapseDoublePeriods } from "@shared/i18n/sentence"

/**
 * The one sentence on the chef visit page that says where the visit stands. It carries the time it talks about,
 * so the page never repeats the same time in a second line, and it only uses wording a chef should see
 * (never the kitchen's review deadline).
 */
export type VisitSentenceTranslate = (key: string, defaultText?: string, vars?: Record<string, unknown>) => string

export interface VisitSentenceInput {
  bookingStatus?: string
  checkinStatus: string
  canCheckin: boolean
  canCheckout: boolean
  beforeCheckinOpens: boolean
  /** The booked time is over (the visit clock reads booked_time_ended or ended). */
  clockEnded: boolean
  /** Still checked in after the booked end, and checkout is still open. */
  lateCheckout: boolean
  /** The kitchen's inspection outcome. Only the "all good" outcome changes the chef's wording. */
  inspectionOutcome?: string
  /** The start has passed and the chef has not checked in. */
  startedBeforeCheckin: boolean
  /** The chef checked in after the booked start. */
  checkedInLate: boolean
  /** Kitchen-local clock times, already formatted ("9:28 a.m."). */
  checkedInTime?: string
  checkoutTime?: string
  /** Booked end with zone, e.g. "11:59 p.m. Newfoundland Time". */
  bookingEnds?: string
  kitchen: string
}

export interface VisitSentence {
  text: string
  /** True when the sentence already states the check-in time, so no separate "Check-in time" row is needed. */
  coversCheckin: boolean
  /** True when the sentence already states the checkout time. */
  coversCheckout: boolean
}

export function visitStatusSentence(input: VisitSentenceInput, t: VisitSentenceTranslate): VisitSentence {
  const result = buildSentence(input, t)
  // A time like "9:28 a.m." already ends in a period; the template adds its own.
  return { ...result, text: collapseDoublePeriods(result.text) }
}

function buildSentence(input: VisitSentenceInput, t: VisitSentenceTranslate): VisitSentence {
  const { bookingStatus, checkinStatus, canCheckin, canCheckout, beforeCheckinOpens, clockEnded, lateCheckout,
    inspectionOutcome, startedBeforeCheckin, checkedInLate, checkedInTime, checkoutTime, bookingEnds, kitchen } = input
  const plain = (text: string): VisitSentence => ({ text, coversCheckin: false, coversCheckout: false })
  const stillEnds = (end?: string) => end ? ` ${t("kciBookingStillEnds", "Your booking still ends at {end}.", { end })}` : ""

  if (lateCheckout) {
    return plain(t("kciOverstayBanner", "Your booking ended at {end}. Please check out now. {kitchen} may charge for the extra time.", { end: bookingEnds, kitchen }))
  }
  if (clockEnded && checkinStatus === "checked_in") {
    return plain(t("kciVisitEndedNoCheckout", "Your booked time has ended and your checkout wasn’t recorded. Message {kitchen} if your departure needs to be added.", { kitchen }))
  }
  if (clockEnded && checkinStatus === "not_checked_in") {
    return plain(t("kvEndedNoCheckin", "This visit is over. No check-in was recorded."))
  }

  switch (checkinStatus) {
    case "checked_in": {
      if (!checkedInTime) {
        return plain(canCheckout
          ? t("kciStatusCheckedIn", "You’re checked in. Choose Check out when you’re finished.")
          : t("kciStatusCheckedInNoAction", "You’re checked in."))
      }
      const base = canCheckout
        ? t("kvCheckedIn", "You checked in at {time}. Choose Check out when you’re finished.", { time: checkedInTime })
        : t("kvCheckedInNoAction", "You checked in at {time}.", { time: checkedInTime })
      return { text: base + (checkedInLate ? stillEnds(bookingEnds) : ""), coversCheckin: true, coversCheckout: false }
    }
    case "checkout_requested":
      return checkoutTime
        ? { text: t("kvCheckedOut", "You checked out at {time}.", { time: checkoutTime }), coversCheckin: false, coversCheckout: true }
        : plain(t("kvCheckedOutNoTime", "You checked out."))
    case "checked_out":
      return plain(inspectionOutcome === "manager_cleared"
        ? t("kvVisitCompleteCleared", "{kitchen} checked the space and it’s all good.", { kitchen })
        : t("kvVisitComplete", "See your booking for the record."))
    case "checkout_claim_filed":
      return plain(t("kciStatusClaimFiled", "The kitchen manager reported an issue after this visit. Open your booking to see what was reported."))
    case "no_show":
      return plain(t("kciStatusNoShow", "The kitchen reported this visit as a no-show. If that’s not right, contact Local Cooks Support."))
  }

  if (bookingStatus === "cancelled") return plain(t("kciStatusCancelled", "This booking was cancelled. There’s nothing to do for this visit."))
  if (bookingStatus === "completed") return plain(t("kciStatusCompletedNoCheckin", "This booking is complete. No check-in was recorded for this visit."))
  if (bookingStatus === "cancellation_requested") return plain(t("kciStatusCancellationRequested", "Check-in isn’t available while your cancellation request is open."))
  if (bookingStatus !== "confirmed") return plain(t("kciStatusAwaitingConfirmation", "Check-in becomes available after the kitchen confirms your booking."))
  if (canCheckin) {
    return plain(t("kvCheckinOpen", "Check-in is open. Follow the arrival instructions, then confirm below.") + (startedBeforeCheckin ? stillEnds(bookingEnds) : ""))
  }
  return plain(beforeCheckinOpens
    ? t("kciStatusCheckinLater", "Check-in isn’t open yet. Come back to this page when it opens.")
    : t("kciStatusCheckinClosed", "Check-in for this visit has closed. Contact the kitchen manager if you need your visit recorded."))
}
