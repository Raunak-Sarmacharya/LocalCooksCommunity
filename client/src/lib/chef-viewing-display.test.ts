import { describe, expect, it } from "vitest";
import { chefTourCard, chefTourWhen, chefTourRowHasDetails, chefTourVisitAction, countPendingOrUpcomingTours, formatTourWhen, isPendingOrUpcomingTour, normalizeChefTourRow, viewingStatusBadge } from "./chef-viewing-display";
import { tourAttendance } from '@shared/tour-attendance';

describe('chef visit action timing', () => {
  const tour = { id: 1, status: 'confirmed', scheduledAt: '2026-10-05T12:15:00Z', durationMinutes: 30, updatedAt: '2026-10-05T11:00:00Z', targetedKitchenId: 40 };
  const attendance = tourAttendance(tour, 5, new Date('2026-10-05T12:15:00Z'));
  it('does not turn confirmation or stale eligibility into an early or expired arrival prompt', () => {
    const row = { ...tour, attendance };
    expect(chefTourVisitAction(row, Date.parse('2026-10-05T12:09:59Z'))).toBeNull();
    expect(chefTourVisitAction(row, Date.parse('2026-10-05T12:10:00Z'))).toBe('arrival');
    expect(chefTourVisitAction(row, Date.parse('2026-10-05T12:45:00Z'))).toBe('arrival');
    expect(chefTourVisitAction(row, Date.parse('2026-10-05T12:45:01Z'))).toBeNull();
    expect(chefTourVisitAction({ ...row, status: 'pending' }, Date.parse('2026-10-05T12:15:00Z'))).toBeNull();
    expect(chefTourVisitAction({ ...row, disruptionReason: 'weather' }, Date.parse('2026-10-05T12:15:00Z'))).toBeNull();
    expect(chefTourVisitAction(tour, Date.parse('2026-10-05T12:15:00Z'))).toBeNull();
  });
  it('keeps eligible departure after a terminal result but hides blocked or already saved departure', () => {
    const row = { ...tour, status: 'completed', checkedInAt: '2026-10-05T12:15:00Z', attendance: { ...attendance, canCheckOut: true } };
    expect(chefTourVisitAction(row)).toBe('departure');
    expect(chefTourVisitAction({ ...row, checkedOutAt: '2026-10-05T12:30:00Z' })).toBeNull();
    expect(chefTourVisitAction({ ...row, attendance: { ...row.attendance, canCheckOut: false } })).toBeNull();
  });
});

describe("viewingStatusBadge", () => {
  it("maps both review gates to warning and confirmed to success", () => {
    expect(viewingStatusBadge("pending_local_cooks")).toEqual({
      variant: "warning",
      labelKey: "tourStatusPending",
      defaultLabel: "Request sent",
    });
    expect(viewingStatusBadge("pending").variant).toBe("warning");
    expect(viewingStatusBadge("confirmed").variant).toBe("success");
    expect(viewingStatusBadge("cancelled", "denied").defaultLabel).toBe("Declined");
    expect(viewingStatusBadge("cancelled", "approved", "manager_declined").defaultLabel).toBe("Declined");
    expect(viewingStatusBadge("cancelled", "approved", "chef").defaultLabel).toBe("Cancelled");
  });

  it("reserves destructive for cancel / no-show only", () => {
    expect(viewingStatusBadge("cancelled").variant).toBe("destructive");
    expect(viewingStatusBadge("no_show").variant).toBe("destructive");
    expect(viewingStatusBadge("completed").variant).not.toBe("destructive");
  });
});

describe("formatTourWhen", () => {
  it('uses Newfoundland clocks without suffixes across the autumn DST change', () => {
    expect(formatTourWhen('2026-11-01T04:15:00Z', 30, 'Asia/Kolkata')).toContain('1:45 AM – 1:15 AM');
  });
  it('uses Newfoundland summer/winter clocks regardless of supplied/browser timezone', () => {
    expect(formatTourWhen('2026-10-08T02:15:00Z', null, 'Asia/Kolkata')).toContain('Oct 7, 2026');
    expect(formatTourWhen('2026-10-08T02:15:00Z', null, 'Asia/Kolkata')).toContain('11:45 PM');
    expect(formatTourWhen('2026-01-07T12:30:00Z', null, 'UTC')).toContain('9:00 AM');
    expect(formatTourWhen('2026-10-08T02:15:00Z', 30, 'UTC')).toContain('Oct 8, 2026');
  });
  it("appends end time when duration is set", () => {
    const label = formatTourWhen("2026-08-31T12:25:00.000Z", 30, "America/St_Johns");
    expect(label).toContain("–");
    expect(label.length).toBeGreaterThan(12);
  });

  it("omits end when duration missing", () => {
    const label = formatTourWhen("2026-08-31T12:25:00.000Z", null, "America/St_Johns");
    expect(label).not.toContain("–");
  });
});

describe("normalizeChefTourRow", () => {
  it('does not use internal manager notes as chef messages', () => {
    const row = normalizeChefTourRow({ viewing: { id: 4, scheduledAt: '2026-10-01T12:00:00Z', managerNotes: 'PRIVATE ADMIN', sharedManagerNotes: 'Hello chef' } });
    expect(row?.sharedManagerNotes).toBe('Hello chef');
    expect(JSON.stringify(row)).not.toContain('PRIVATE ADMIN');
    expect(viewingStatusBadge('cancelled', null, 'manager', 'access_unavailable').defaultLabel).toBe('Couldn’t take place');
  });
  it("flattens nested API rows and drops empty intake", () => {
    const row = normalizeChefTourRow({
      locationName: "Satya Test",
      locationAddress: "14 Water St",
      timezone: "America/St_Johns",
      chefName: "Alex Chef",
      chefEmail: "alex@example.com",
      managerName: "Alex",
      viewing: {
        id: 7,
        locationId: 3,
        status: "pending",
        scheduledAt: "2026-08-31T12:25:00.000Z",
        createdAt: "2026-08-20T10:00:00.000Z",
        durationMinutes: 30,
        chefNotes: "Need cold storage",
        intakeData: { intendedUse: "meal prep", skip: "" },
      },
    });
    expect(row?.locationName).toBe("Satya Test");
    expect(row?.chefNotes).toBe("Need cold storage");
    expect(row?.submittedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(row?.chefName).toBe("Alex Chef");
    expect(row?.chefEmail).toBe("alex@example.com");
    expect(row?.timezone).toBe("America/St_Johns");
    expect(row?.intakeEntries).toEqual([["intendedUse", "meal prep"]]);
    expect(chefTourRowHasDetails(row!)).toBe(true);
  });

  it("returns null for incomplete payloads", () => {
    expect(normalizeChefTourRow({})).toBeNull();
    expect(normalizeChefTourRow(null)).toBeNull();
  });
});

describe("isPendingOrUpcomingTour", () => {
  const now = Date.parse("2026-09-05T12:00:00.000Z");

  it("does not count stale pending requests", () => {
    expect(
      isPendingOrUpcomingTour(
        { status: "pending", scheduledAt: "2026-01-01T00:00:00.000Z", durationMinutes: 30 },
        now
      )
    ).toBe(false);
    expect(
      isPendingOrUpcomingTour(
        { status: "pending_local_cooks", scheduledAt: "2026-01-01T00:00:00.000Z", durationMinutes: 30 },
        now
      )
    ).toBe(false);
  });

  it("counts confirmed only while not finished", () => {
    expect(
      isPendingOrUpcomingTour(
        { status: "confirmed", scheduledAt: "2026-09-05T11:45:00.000Z", durationMinutes: 30 },
        now
      )
    ).toBe(true);
    expect(
      isPendingOrUpcomingTour(
        { status: "confirmed", scheduledAt: "2026-09-05T10:00:00.000Z", durationMinutes: 30 },
        now
      )
    ).toBe(false);
  });

  it("ignores completed / cancelled", () => {
    expect(
      isPendingOrUpcomingTour(
        { status: "completed", scheduledAt: "2026-09-06T12:00:00.000Z", durationMinutes: 30 },
        now
      )
    ).toBe(false);
    expect(
      countPendingOrUpcomingTours(
        [
          { status: "pending", scheduledAt: "2026-01-01T00:00:00.000Z", durationMinutes: 30 },
          { status: "cancelled", scheduledAt: "2026-09-06T12:00:00.000Z", durationMinutes: 30 },
        ],
        now
      )
    ).toBe(0);
  });
  it('keeps a confirmed tour current while it is in progress, then moves it to history', () => {
    const tour = { status: 'confirmed', scheduledAt: '2026-09-05T11:45:00.000Z', durationMinutes: 30 };
    expect(isPendingOrUpcomingTour(tour, Date.parse('2026-09-05T12:00:00Z'))).toBe(true);
    expect(isPendingOrUpcomingTour(tour, Date.parse('2026-09-05T12:15:01Z'))).toBe(false);
    expect(tour.status).toBe('confirmed');
  });
});

describe('chef tour cards', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const row = (viewing: Record<string, unknown>, extra: Record<string, unknown> = {}) => normalizeChefTourRow({ viewing: { id: 9, locationId: 4, targetedKitchenId: 40, status: 'confirmed', scheduledAt: '2026-10-29T13:45:00Z', durationMinutes: 30, ...viewing }, locationName: 'Water St', ...extra })!;
  it('writes the when line in 12-hour a.m./p.m. Newfoundland time, year only when it differs', () => {
    expect(chefTourWhen('2026-10-29T13:45:00Z', 30, 'en-CA', now)).toBe('Thu, Oct 29 · 11:15–11:45 a.m.');
    expect(chefTourWhen('2027-01-07T20:00:00Z', null, 'en-CA', now)).toContain('2027');
  });
  it('asks for action only when the chef must act and files closed tours under past', () => {
    const pick = (card: ReturnType<typeof chefTourCard>) => [card.past, card.tone, card.status[1], card.action];
    expect(pick(chefTourCard(row({ status: 'pending', rescheduleProposedSlots: ['2026-10-30T13:45:00Z'] }), now))).toEqual([false, 'amber', 'Answer needed', 'review']);
    expect(pick(chefTourCard(row({ status: 'pending' }), now))).toEqual([false, 'grey', 'Requested', 'open']);
    expect(pick(chefTourCard(row({}, { reconfirmation: { canReply: true, reply: null } }), now))).toEqual([false, 'amber', 'Answer needed', 'review']);
    expect(pick(chefTourCard(row({}), now))).toEqual([false, 'green', 'Confirmed', 'open']);
    expect(pick(chefTourCard(row({ status: 'completed', scheduledAt: '2026-10-20T13:45:00Z' }), now))).toEqual([true, 'green', 'Toured', 'apply']);
    expect(pick(chefTourCard(row({ status: 'cancelled', cancelledBy: 'manager_declined' }), now))).toEqual([true, 'grey', 'Declined', 'open']);
    expect(pick(chefTourCard(row({ status: 'pending', scheduledAt: '2026-10-20T13:45:00Z' }), now))).toEqual([true, 'grey', 'Request expired', 'open']);
    expect(chefTourCard(row({ status: 'cancelled', cancelledBy: 'chef' }), now).line[1]).toBe('You cancelled this tour.');
    expect(chefTourCard(row({ status: 'cancelled', cancelledBy: 'manager' }), now).line[1]).toBe('The kitchen cancelled this tour.');
    expect(chefTourCard(row({ status: 'cancelled', cancelledBy: 'local_cooks', disruptionReason: 'outcome_unknown' }), now).status[1]).toBe('Closed');
  });
});
