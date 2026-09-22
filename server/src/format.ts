import { DateTime } from "luxon";
import { COURSE_DAILY_MINUTES, WEEKDAY_LABELS, clockMinutesLabel } from "./availability.js";
import { getBookingBlock, getRescheduleBlock, spotsRemaining, RESCHEDULE_CUTOFF_MS } from "./rules.js";
import { fromIso, ZONE } from "./time.js";
import type {
  AvailabilityRuleDto,
  AvailabilityRuleRow,
  BookingDto,
  BookingRow,
  CourseProductDto,
  CourseProductRow,
  CourseRunDto,
  CourseRunRow,
  CourseSessionDto,
  CourseSessionRow,
  LocationDto,
  LocationRow,
  SlotDto,
  SlotRow,
} from "./types.js";

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
  kind?: "lesson" | "course";
}): string {
  const stamp = (value: DateTime) => value.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const label = input.kind === "course" ? "Crash course" : "Swimming lesson";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `${label} — ${input.title}`,
    dates: `${stamp(input.startsAt)}/${stamp(input.endsAt)}`,
    details: `Lido booking ${input.reference}. Adult swimming (${input.level}) at ${input.location}.`,
    location: `${input.location}, ${input.address}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function presentLocation(row: LocationRow): LocationDto {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    enabled: Number(row.enabled) !== 0,
  };
}

export function presentSlot(slot: SlotRow, occupied: number, now: DateTime): SlotDto {
  const startsAt = fromIso(slot.starts_at);
  const endsAt = fromIso(slot.ends_at);
  const local = startsAt.setZone(ZONE);
  const week = weekParts(startsAt);
  const spotsLeft = spotsRemaining(slot.capacity, occupied);
  const window = getBookingBlock(startsAt, now);
  const enabled = Number(slot.enabled) !== 0;
  const cancelled = Number(slot.cancelled) !== 0;
  let unavailableReason = window.ok ? null : window.message;
  if (!unavailableReason && (!enabled || cancelled)) {
    unavailableReason = "This session isn't available.";
  }
  if (!unavailableReason && spotsLeft <= 0) {
    unavailableReason = "This session is full.";
  }
  const dayLabel =
    local.year === now.setZone(ZONE).year
      ? local.toFormat("cccc d LLLL")
      : local.toFormat("cccc d LLLL yyyy");
  const spotsLabel = spotsLeft <= 0 ? "Full" : spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`;
  return {
    id: slot.id,
    locationId: slot.location_id,
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
    startTimeLabel: clockLabel(local),
    dateKey: local.toFormat("yyyy-MM-dd"),
    weekKey: week.weekKey,
    weekLabel: week.weekLabel,
    durationMinutes: slot.duration_minutes,
    pricePence: slot.price_pence,
    priceLabel: formatGBP(slot.price_pence),
    capacity: slot.capacity,
    spotsLeft,
    spotsLabel,
    bookable: unavailableReason === null,
    unavailableReason,
    soon: startsAt.toMillis() > now.toMillis() && startsAt.toMillis() - now.toMillis() < RESCHEDULE_CUTOFF_MS,
    enabled,
    cancelled,
    ruleId: slot.rule_id,
  };
}

export function presentRule(rule: AvailabilityRuleRow, location: LocationRow): AvailabilityRuleDto {
  return {
    id: rule.id,
    locationId: rule.location_id,
    locationName: location.name,
    locationAddress: location.address,
    weekday: rule.weekday,
    weekdayLabel: WEEKDAY_LABELS[rule.weekday] ?? `Day ${rule.weekday}`,
    hour: rule.hour,
    minute: rule.minute,
    timeLabel: clockMinutesLabel(rule.hour, rule.minute),
    durationMinutes: rule.duration_minutes,
    capacity: rule.capacity,
    pricePence: rule.price_pence,
    priceLabel: formatGBP(rule.price_pence),
    title: rule.title,
    level: rule.level,
    blurb: rule.blurb,
    instructor: rule.instructor,
    enabled: Number(rule.enabled) !== 0,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

export function presentCourseProduct(product: CourseProductRow, location: LocationRow): CourseProductDto {
  return {
    id: product.id,
    locationId: product.location_id,
    locationName: location.name,
    days: product.days,
    dailyMinutes: product.daily_minutes,
    capacity: product.capacity,
    pricePence: product.price_pence,
    priceLabel: formatGBP(product.price_pence),
    title: product.title,
    level: product.level,
    blurb: product.blurb,
    instructor: product.instructor,
    enabled: Number(product.enabled) !== 0,
  };
}

export function presentCourseSession(row: CourseSessionRow): CourseSessionDto {
  const startsAt = fromIso(row.starts_at);
  const endsAt = fromIso(row.ends_at);
  const local = startsAt.setZone(ZONE);
  return {
    dayIndex: row.day_index,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    dayLabel: local.toFormat("cccc d LLLL"),
    timeLabel: `${clockLabel(local)}–${clockLabel(endsAt)}`,
    dateKey: local.toFormat("yyyy-MM-dd"),
  };
}

export function presentCourseRun(
  run: CourseRunRow,
  sessions: CourseSessionRow[],
  occupied: number,
  now: DateTime,
): CourseRunDto {
  const ordered = [...sessions].sort((a, b) => a.day_index - b.day_index);
  const sessionDtos = ordered.map(presentCourseSession);
  const firstStarts = fromIso(ordered[0]?.starts_at ?? run.first_date);
  const lastEnds = fromIso(ordered[ordered.length - 1]?.ends_at ?? run.first_date);
  const firstLocal = firstStarts.setZone(ZONE);
  const lastLocal = lastEnds.setZone(ZONE);
  const dailyLocal = DateTime.fromObject(
    { hour: run.daily_hour, minute: run.daily_minute },
    { zone: ZONE },
  );
  const dateSummary =
    firstLocal.toFormat("d LLL") === lastLocal.toFormat("d LLL yyyy")
      ? `${firstLocal.toFormat("cccc d LLLL")} · ${run.days} days`
      : `${firstLocal.toFormat("d LLL")} – ${lastLocal.toFormat("d LLL yyyy")}`;
  const spotsLeft = spotsRemaining(run.capacity, occupied);
  const window = getBookingBlock(firstStarts, now);
  const enabled = Number(run.enabled) !== 0;
  const cancelled = Number(run.cancelled) !== 0;
  let unavailableReason = window.ok ? null : window.message;
  if (!unavailableReason && (!enabled || cancelled)) {
    unavailableReason = "This course isn't available.";
  }
  if (!unavailableReason && spotsLeft <= 0) {
    unavailableReason = "This course is full.";
  }
  const spotsLabel = spotsLeft <= 0 ? "Full" : spotsLeft === 1 ? "1 place left" : `${spotsLeft} places left`;
  return {
    id: run.id,
    productId: run.product_id,
    locationId: run.location_id,
    title: run.title,
    level: run.level,
    blurb: run.blurb,
    instructor: run.instructor,
    location: run.location,
    address: run.address,
    days: run.days,
    dailyMinutes: run.daily_minutes,
    firstDate: run.first_date,
    dailyHour: run.daily_hour,
    dailyMinute: run.daily_minute,
    dailyTimeLabel: clockMinutesLabel(run.daily_hour, run.daily_minute),
    dateSummary,
    startsAt: ordered[0]?.starts_at ?? toUtcIsoFallback(firstStarts),
    endsAt: ordered[ordered.length - 1]?.ends_at ?? toUtcIsoFallback(lastEnds),
    pricePence: run.price_pence,
    priceLabel: formatGBP(run.price_pence),
    capacity: run.capacity,
    spotsLeft,
    spotsLabel,
    bookable: unavailableReason === null,
    unavailableReason,
    soon:
      firstStarts.toMillis() > now.toMillis() &&
      firstStarts.toMillis() - now.toMillis() < RESCHEDULE_CUTOFF_MS,
    enabled,
    cancelled,
    sessions: sessionDtos,
  };
}

function toUtcIsoFallback(value: DateTime): string {
  return value.toUTC().toISO() ?? value.toISO() ?? "";
}

export function presentBooking(
  booking: BookingRow,
  now: DateTime,
  details:
    | { slot: SlotRow; occupied: number }
    | { run: CourseRunRow; sessions: CourseSessionRow[]; occupied: number },
): BookingDto {
  const kind = booking.kind ?? "lesson";
  if (kind === "course" && "run" in details) {
    const course = presentCourseRun(details.run, details.sessions, details.occupied, now);
    const firstStarts = fromIso(course.startsAt);
    const decision = getRescheduleBlock(firstStarts, now);
    let rescheduleAllowed = booking.status === "confirmed" && decision.ok;
    let rescheduleBlockedReason = decision.ok ? null : decision.message;
    if (booking.status === "pending_payment") {
      rescheduleAllowed = false;
      rescheduleBlockedReason = "Finish payment before moving this course.";
    } else if (booking.status !== "confirmed") {
      rescheduleAllowed = false;
      rescheduleBlockedReason = "This booking can no longer be moved.";
    }
    const hold = booking.hold_expires_at ? fromIso(booking.hold_expires_at) : null;
    return {
      id: booking.id,
      reference: booking.reference,
      kind: "course",
      status: booking.status,
      paymentSource: booking.payment_source,
      pricePence: booking.price_pence,
      priceLabel: formatGBP(booking.price_pence),
      createdAt: booking.created_at,
      confirmedAt: booking.confirmed_at,
      holdExpiresAt: booking.hold_expires_at,
      holdExpiresLabel: hold && booking.status === "pending_payment" ? formatDeadline(hold) : null,
      phase: firstStarts.toMillis() > now.toMillis() ? "upcoming" : "past",
      rescheduleAllowed,
      rescheduleBlockedReason,
      rescheduleClosesAt: decision.closesAt.toUTC().toISO() ?? decision.closesAt.toISO() ?? "",
      rescheduleClosesLabel: formatDeadline(decision.closesAt),
      calendarSynced: Boolean(booking.calendar_event_id),
      googleCalendarUrl:
        booking.status === "confirmed"
          ? googleCalendarTemplateUrl({
              title: details.run.title,
              startsAt: firstStarts,
              endsAt: fromIso(course.endsAt),
              location: details.run.location,
              address: details.run.address,
              reference: booking.reference,
              level: details.run.level,
              kind: "course",
            })
          : null,
      slot: null,
      course,
    };
  }

  const slotRow = "slot" in details ? details.slot : null;
  if (!slotRow) throw new Error("Lesson bookings require a slot.");
  const occupied = "occupied" in details ? details.occupied : 0;
  const startsAt = fromIso(slotRow.starts_at);
  const presentedSlot = presentSlot(slotRow, occupied, now);
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
    kind: "lesson",
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
            title: slotRow.title,
            startsAt,
            endsAt: fromIso(slotRow.ends_at),
            location: slotRow.location,
            address: slotRow.address,
            reference: booking.reference,
            level: slotRow.level,
            kind: "lesson",
          })
        : null,
    slot: presentedSlot,
    course: null,
  };
}

export function courseDailyMinutesLabel(): number {
  return COURSE_DAILY_MINUTES;
}
