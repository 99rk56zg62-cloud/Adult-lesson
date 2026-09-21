import { DateTime } from "luxon";
import { getBookingBlock, getRescheduleBlock, spotsRemaining, RESCHEDULE_CUTOFF_MS } from "./rules.js";
import { fromIso, ZONE } from "./time.js";
import type { BookingDto, BookingRow, SlotDto, SlotRow } from "./types.js";

export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

export function clockLabel(value: DateTime): string {
  const local = value.setZone(ZONE);
  return `${local.toFormat("h:mm")}${local.toFormat("a").toLowerCase()}`;
}

export function formatDeadline(value: DateTime): string {
  const local = value.setZone(ZONE);
  return `${local.toFormat("cccc d LLLL")}, ${clockLabel(local)}`;
}

export function weekParts(start: DateTime): { weekKey: string; weekLabel: string } {
  const local = start.setZone(ZONE);
  const monday = local.minus({ days: local.weekday - 1 }).startOf("day");
  const sunday = monday.plus({ days: 6 });
  const weekKey = monday.toFormat("yyyy-MM-dd");
  const weekLabel =
    monday.month === sunday.month
      ? `${monday.toFormat("d")}–${sunday.toFormat("d LLL")}`
      : `${monday.toFormat("d LLL")} – ${sunday.toFormat("d LLL")}`;
  return { weekKey, weekLabel };
}

export function googleCalendarTemplateUrl(input: {
  title: string;
  startsAt: DateTime;
  endsAt: DateTime;
  location: string;
  address: string;
  reference: string;
  level: string;
}): string {
  const stamp = (value: DateTime) => value.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Swimming lesson — ${input.title}`,
    dates: `${stamp(input.startsAt)}/${stamp(input.endsAt)}`,
    details: `Lido booking ${input.reference}. Adult swimming lesson (${input.level}) at ${input.location}.`,
    location: `${input.location}, ${input.address}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function presentSlot(slot: SlotRow, occupied: number, now: DateTime): SlotDto {
  const startsAt = fromIso(slot.starts_at);
  const endsAt = fromIso(slot.ends_at);
  const local = startsAt.setZone(ZONE);
  const week = weekParts(startsAt);
  const spotsLeft = spotsRemaining(slot.capacity, occupied);
  const window = getBookingBlock(startsAt, now);
  let unavailableReason = window.ok ? null : window.message;
  if (window.ok && spotsLeft <= 0) {
    unavailableReason = "This session is full.";
  }
  const dayLabel =
    local.year === now.setZone(ZONE).year
      ? local.toFormat("cccc d LLLL")
      : local.toFormat("cccc d LLLL yyyy");
  const spotsLabel = spotsLeft <= 0 ? "Full" : spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`;
  return {
    id: slot.id,
    title: slot.title,
    level: slot.level,
    blurb: slot.blurb,
    location: slot.location,
    address: slot.address,
    instructor: slot.instructor,
    startsAt: slot.starts_at,
    endsAt: slot.ends_at,
    dayLabel,
    timeLabel: `${clockLabel(local)}–${clockLabel(endsAt)}`,
    dateKey: local.toFormat("yyyy-MM-dd"),
    weekKey: week.weekKey,
    weekLabel: week.weekLabel,
    durationMinutes: Math.round((endsAt.toMillis() - startsAt.toMillis()) / 60000),
    pricePence: slot.price_pence,
    priceLabel: formatGBP(slot.price_pence),
    capacity: slot.capacity,
    spotsLeft,
    spotsLabel,
    bookable: unavailableReason === null,
    unavailableReason,
    soon: startsAt.toMillis() > now.toMillis() && startsAt.toMillis() - now.toMillis() < RESCHEDULE_CUTOFF_MS,
  };
}

export function presentBooking(booking: BookingRow, slot: SlotRow, occupied: number, now: DateTime): BookingDto {
  const startsAt = fromIso(slot.starts_at);
  const presentedSlot = presentSlot(slot, occupied, now);
  const decision = getRescheduleBlock(startsAt, now);
  let rescheduleAllowed = booking.status === "confirmed" && decision.ok;
  let rescheduleBlockedReason = decision.ok ? null : decision.message;
  if (booking.status === "pending_payment") {
    rescheduleAllowed = false;
    rescheduleBlockedReason = "Finish payment before rearranging this lesson.";
  } else if (booking.status !== "confirmed") {
    rescheduleAllowed = false;
    rescheduleBlockedReason = "This booking can no longer be rearranged.";
  }
  const hold = booking.hold_expires_at ? fromIso(booking.hold_expires_at) : null;
  return {
    id: booking.id,
    reference: booking.reference,
    status: booking.status,
    paymentSource: booking.payment_source,
    pricePence: booking.price_pence,
    priceLabel: formatGBP(booking.price_pence),
    createdAt: booking.created_at,
    confirmedAt: booking.confirmed_at,
    holdExpiresAt: booking.hold_expires_at,
    holdExpiresLabel: hold && booking.status === "pending_payment" ? formatDeadline(hold) : null,
    phase: startsAt.toMillis() > now.toMillis() ? "upcoming" : "past",
    rescheduleAllowed,
    rescheduleBlockedReason,
    rescheduleClosesAt: decision.closesAt.toUTC().toISO() ?? decision.closesAt.toISO() ?? "",
    rescheduleClosesLabel: formatDeadline(decision.closesAt),
    calendarSynced: Boolean(booking.calendar_event_id),
    googleCalendarUrl:
      booking.status === "confirmed"
        ? googleCalendarTemplateUrl({
            title: slot.title,
            startsAt,
            endsAt: fromIso(slot.ends_at),
            location: slot.location,
            address: slot.address,
            reference: booking.reference,
            level: slot.level,
          })
        : null,
    slot: presentedSlot,
  };
}
