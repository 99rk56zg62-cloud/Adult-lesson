import { DateTime } from "luxon";
import { ZONE } from "./time.js";

export const MAX_ADVANCE_WEEKS = 6;
export const RESCHEDULE_CUTOFF_MS = 24 * 60 * 60 * 1000;
export const HOLD_MS = 45 * 60 * 1000;

export type RuleFailure = { ok: false; code: string; message: string };
export type BookingWindowResult = { ok: true } | RuleFailure;

export function lastBookableDay(now: DateTime): DateTime {
  return now.setZone(ZONE).startOf("day").plus({ weeks: MAX_ADVANCE_WEEKS });
}

export function getBookingBlock(startsAt: DateTime, now: DateTime): BookingWindowResult {
  if (!startsAt.isValid) {
    return { ok: false, code: "VALIDATION", message: "This session has an invalid start time." };
  }
  if (startsAt.toMillis() <= now.toMillis()) {
    return { ok: false, code: "SLOT_IN_PAST", message: "This session has already started." };
  }
  const startDay = startsAt.setZone(ZONE).startOf("day");
  if (startDay > lastBookableDay(now)) {
    return {
      ok: false,
      code: "TOO_FAR_AHEAD",
      message: "You can only book sessions up to 6 weeks ahead.",
    };
  }
  return { ok: true };
}

export type RescheduleDecision =
  | { ok: true; closesAt: DateTime }
  | { ok: false; code: string; message: string; closesAt: DateTime };

export function getRescheduleBlock(startsAt: DateTime, now: DateTime): RescheduleDecision {
  const closesAt = DateTime.fromMillis(startsAt.toMillis() - RESCHEDULE_CUTOFF_MS, { zone: "utc" });
  if (startsAt.toMillis() <= now.toMillis()) {
    return {
      ok: false,
      code: "RESCHEDULE_WINDOW_CLOSED",
      message: "This session has already started.",
      closesAt,
    };
  }
  if (now.toMillis() > closesAt.toMillis()) {
    return {
      ok: false,
      code: "RESCHEDULE_WINDOW_CLOSED",
      message: "Bookings can only be rearranged until 24 hours before the session starts.",
      closesAt,
    };
  }
  return { ok: true, closesAt };
}

export function spotsRemaining(capacity: number, occupied: number): number {
  return Math.max(0, capacity - occupied);
}
