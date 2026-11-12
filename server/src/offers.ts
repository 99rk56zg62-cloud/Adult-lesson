import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { LESSON_DURATION_PRICES, LESSON_DURATIONS, clockMinutesLabel } from "./availability.js";
import { getRow, getRows } from "./db.js";
import { formatGBP, presentSlot } from "./format.js";
import { AppError } from "./errors.js";
import { getBookingBlock } from "./rules.js";
import { fromIso, toUtcIso, ZONE } from "./time.js";
import type { LocationRow, SlotDto, SlotRow } from "./types.js";

export type WindowRow = {
  id: string;
  location_id: string;
  weekday: number;
  start_hour: number;
  start_minute: number;
  end_hour: number;
  end_minute: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

type Busy = { startMs: number; endMs: number; slotId: string | null; userId: string | null; kind: "booking" | "course" };

export function offerId(locationId: string, dateKey: string, hour: number, minute: number, duration: number, party: number): string {
  return `offer_${locationId}_${dateKey}_${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}_${duration}_${party}`;
}

export function parseOfferId(id: string): {
  locationId: string;
  dateKey: string;
  hour: number;
  minute: number;
  duration: number;
  party: number;
} | null {
  const match = /^offer_(.+)_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})_(\d+)_(\d+)$/.exec(id);
  if (!match) return null;
  return {
    locationId: match[1]!,
    dateKey: match[2]!,
    hour: Number(match[3]),
    minute: Number(match[4]),
    duration: Number(match[5]),
    party: Number(match[6]),
  };
}

export function windowStarts(startMin: number, endMin: number, duration: number): number[] {
  const starts: number[] = [];
  let cursor = Math.ceil(startMin / 30) * 30;
  while (cursor + duration <= endMin) {
    starts.push(cursor);
    cursor += 30;
  }
  return starts;
}

export function ensureLessonRates(db: DatabaseSync, nowIso: string) {
  for (const minutes of LESSON_DURATIONS) {
    db.prepare(
      `INSERT OR IGNORE INTO lesson_rates (duration_minutes, price_pence, updated_at) VALUES (?, ?, ?)`,
    ).run(minutes, LESSON_DURATION_PRICES[minutes], nowIso);
  }
}

export function lessonPricePence(db: DatabaseSync, duration: number, nowIso: string): number {
  ensureLessonRates(db, nowIso);
  const row = getRow<{ price_pence: number }>(
    db,
    `SELECT price_pence FROM lesson_rates WHERE duration_minutes = ?`,
    duration,
  );
  if (!row) throw new AppError(400, "VALIDATION", "Single lessons are 30 or 60 minutes only.");
  return row.price_pence;
}

export function listLessonRates(db: DatabaseSync, nowIso: string): { durationMinutes: number; pricePence: number; priceLabel: string }[] {
  ensureLessonRates(db, nowIso);
  return getRows<{ duration_minutes: number; price_pence: number }>(
    db,
    `SELECT duration_minutes, price_pence FROM lesson_rates ORDER BY duration_minutes`,
  ).map((row) => ({
    durationMinutes: row.duration_minutes,
    pricePence: row.price_pence,
    priceLabel: formatGBP(row.price_pence),
  }));
}

export function setLessonRate(db: DatabaseSync, duration: number, pricePence: number, nowIso: string) {
  if (!(LESSON_DURATIONS as readonly number[]).includes(duration)) {
    throw new AppError(400, "VALIDATION", "Single lessons are 30 or 60 minutes only.");
  }
  if (!Number.isInteger(pricePence) || pricePence < 50) {
    throw new AppError(400, "VALIDATION", "Enter a valid lesson price.");
  }
  ensureLessonRates(db, nowIso);
  db.prepare(`UPDATE lesson_rates SET price_pence = ?, updated_at = ? WHERE duration_minutes = ?`).run(
    pricePence,
    nowIso,
    duration,
  );
  db.prepare(`UPDATE availability_rules SET price_pence = ? WHERE duration_minutes = ?`).run(pricePence, duration);
  db.prepare(`UPDATE slots SET price_pence = ? WHERE duration_minutes = ? AND starts_at > ?`).run(pricePence, duration, nowIso);
}

export function listWindows(db: DatabaseSync): WindowRow[] {
  return getRows<WindowRow>(db, `SELECT * FROM availability_windows ORDER BY weekday, start_hour, start_minute`);
}

export function upsertWindow(
  db: DatabaseSync,
  id: string,
  input: { locationId: string; weekday: number; startHour: number; startMinute: number; endHour: number; endMinute: number; enabled?: boolean },
  nowIso: string,
): WindowRow {
  const start = input.startHour * 60 + input.startMinute;
  const end = input.endHour * 60 + input.endMinute;
  if (input.weekday < 1 || input.weekday > 7) throw new AppError(400, "VALIDATION", "Choose a day of the week.");
  if (input.startMinute % 30 !== 0 || input.endMinute % 30 !== 0) {
    throw new AppError(400, "VALIDATION", "Window times should be on the hour or half hour.");
  }
  if (end - start < 30) throw new AppError(400, "VALIDATION", "A window needs room for at least a 30 minute lesson.");
  const enabled = input.enabled === false ? 0 : 1;
  const existing = getRow<{ id: string }>(db, `SELECT id FROM availability_windows WHERE id = ?`, id);
  if (existing) {
    db.prepare(
      `UPDATE availability_windows
       SET location_id = ?, weekday = ?, start_hour = ?, start_minute = ?, end_hour = ?, end_minute = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(input.locationId, input.weekday, input.startHour, input.startMinute, input.endHour, input.endMinute, enabled, nowIso, id);
  } else {
    db.prepare(
      `INSERT INTO availability_windows (
        id, location_id, weekday, start_hour, start_minute, end_hour, end_minute, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.locationId, input.weekday, input.startHour, input.startMinute, input.endHour, input.endMinute, enabled, nowIso, nowIso);
  }
  return getRow<WindowRow>(db, `SELECT * FROM availability_windows WHERE id = ?`, id)!;
}

export function listWindowOffers(
  db: DatabaseSync,
  now: DateTime,
  userId: string,
  filters?: { locationId?: string; durationMinutes?: number; partySize?: number; excludeBookingId?: string },
): SlotDto[] {
  const nowIso = toUtcIso(now);
  ensureLessonRates(db, nowIso);
  const locations = getRows<LocationRow>(db, `SELECT * FROM locations WHERE enabled = 1`);
  const windows = getRows<WindowRow>(db, `SELECT * FROM availability_windows WHERE enabled = 1`);
  const busy = busyRanges(db, nowIso, filters?.excludeBookingId);
  const held = new Set(
    getRows<{ slot_id: string }>(
      db,
      `SELECT slot_id FROM bookings
       WHERE user_id = ? AND status = 'pending_payment' AND hold_expires_at > ? AND slot_id IS NOT NULL`,
      userId,
      nowIso,
    ).map((row) => row.slot_id),
  );
  const durations = filters?.durationMinutes ? [filters.durationMinutes] : [...LESSON_DURATIONS];
  const parties = filters?.partySize ? [filters.partySize] : [1, 2];
  const startDay = now.setZone(ZONE).startOf("day");
  const endDay = startDay.plus({ weeks: 6 });
  const offers: SlotDto[] = [];
  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    const dayWindows = windows.filter((window) => {
      if (window.weekday !== day.weekday) return false;
      if (filters?.locationId && window.location_id !== filters.locationId) return false;
      return true;
    });
    if (dayWindows.length === 0) continue;
    const dateKey = day.toFormat("yyyy-MM-dd");
    for (const window of dayWindows) {
      const place = locations.find((location) => location.id === window.location_id);
      if (!place) continue;
      const startMin = window.start_hour * 60 + window.start_minute;
      const endMin = window.end_hour * 60 + window.end_minute;
      const label = `${clockMinutesLabel(window.start_hour, window.start_minute)}–${clockMinutesLabel(window.end_hour, window.end_minute)}`;
      for (const duration of durations) {
        const price = lessonPricePence(db, duration, nowIso);
        for (const minutes of windowStarts(startMin, endMin, duration)) {
          const hour = Math.floor(minutes / 60);
          const minute = minutes % 60;
          const starts = day.set({ hour, minute, second: 0, millisecond: 0 });
          if (starts.toMillis() <= now.toMillis()) continue;
          const ends = starts.plus({ minutes: duration });
          for (const party of parties) {
            const id = offerId(place.id, dateKey, hour, minute, duration, party);
            const clash = clashReason(busy, starts.toMillis(), ends.toMillis(), id, userId);
            const row = syntheticSlot(id, place, starts, ends, duration, party, price);
            const occupied = clash && !held.has(id) ? party : 0;
            const dto = presentSlot(row, occupied, now);
            dto.inBasket = held.has(id);
            dto.windowLabel = label;
            if (clash && !held.has(id)) {
              dto.bookable = false;
              dto.unavailableReason = clash;
              dto.spotsLeft = 0;
              dto.spotsLabel = "Booked";
            }
            if (dto.inBasket) {
              dto.bookable = true;
              dto.unavailableReason = null;
              dto.spotsLabel = "In basket";
            }
            offers.push(dto);
          }
        }
      }
    }
  }
  return offers.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.durationMinutes - b.durationMinutes || a.capacity - b.capacity);
}

export function materializeOffer(db: DatabaseSync, now: DateTime, id: string, exceptBookingId?: string): SlotRow {
  const parsed = parseOfferId(id);
  if (!parsed) throw new AppError(404, "NOT_FOUND", "That session doesn't exist.");
  const existing = getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, id);
  if (existing) {
    assertChoiceStillOpen(db, now, parsed, exceptBookingId);
    return existing;
  }
  assertChoiceStillOpen(db, now, parsed, exceptBookingId);
  const place = getRow<LocationRow>(db, `SELECT * FROM locations WHERE id = ?`, parsed.locationId);
  if (!place || !place.enabled) throw new AppError(409, "SLOT_UNAVAILABLE", "This session isn't available.");
  const starts = DateTime.fromISO(parsed.dateKey, { zone: ZONE }).set({
    hour: parsed.hour,
    minute: parsed.minute,
    second: 0,
    millisecond: 0,
  });
  const price = lessonPricePence(db, parsed.duration, toUtcIso(now));
  db.prepare(
    `INSERT INTO slots (
      id, rule_id, location_id, starts_at, ends_at, duration_minutes, capacity, price_pence,
      title, level, blurb, location, address, instructor, enabled, cancelled
    ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 1, 0)`,
  ).run(
    id,
    place.id,
    toUtcIso(starts),
    toUtcIso(starts.plus({ minutes: parsed.duration })),
    parsed.duration,
    parsed.party,
    price,
    "Adult lesson",
    "A private lesson in the school's open hours.",
    place.name,
    place.address,
    "Your teacher",
  );
  return getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, id)!;
}

function assertChoiceStillOpen(
  db: DatabaseSync,
  now: DateTime,
  parsed: NonNullable<ReturnType<typeof parseOfferId>>,
  exceptBookingId?: string,
) {
  if (!(LESSON_DURATIONS as readonly number[]).includes(parsed.duration) || (parsed.party !== 1 && parsed.party !== 2)) {
    throw new AppError(400, "VALIDATION", "Choose a 30 or 60 minute 1-to-1 or 1-to-2 lesson.");
  }
  if (parsed.minute !== 0 && parsed.minute !== 30) {
    throw new AppError(400, "VALIDATION", "Lessons start on the hour or half hour.");
  }
  const starts = DateTime.fromISO(parsed.dateKey, { zone: ZONE }).set({
    hour: parsed.hour,
    minute: parsed.minute,
    second: 0,
    millisecond: 0,
  });
  const block = getBookingBlock(starts, now);
  if (!block.ok) throw new AppError(400, block.code, block.message);
  const windows = getRows<WindowRow>(
    db,
    `SELECT * FROM availability_windows WHERE enabled = 1 AND location_id = ? AND weekday = ?`,
    parsed.locationId,
    starts.weekday,
  );
  const startMin = parsed.hour * 60 + parsed.minute;
  const fits = windows.some((window) => {
    const open = window.start_hour * 60 + window.start_minute;
    const close = window.end_hour * 60 + window.end_minute;
    return startMin >= open && startMin + parsed.duration <= close;
  });
  if (!fits) throw new AppError(409, "OUTSIDE_WINDOW", "That lesson doesn't fit inside the available hours.");
  const ends = starts.plus({ minutes: parsed.duration });
  const busy = busyRanges(db, toUtcIso(now), exceptBookingId);
  const clash = clashReason(busy, starts.toMillis(), ends.toMillis(), offerId(parsed.locationId, parsed.dateKey, parsed.hour, parsed.minute, parsed.duration, parsed.party), null);
  if (clash) throw new AppError(409, "SLOT_OVERLAP", clash);
}

function syntheticSlot(
  id: string,
  place: LocationRow,
  starts: DateTime,
  ends: DateTime,
  duration: number,
  party: number,
  price: number,
): SlotRow {
  return {
    id,
    rule_id: null,
    location_id: place.id,
    starts_at: toUtcIso(starts),
    ends_at: toUtcIso(ends),
    duration_minutes: duration,
    capacity: party,
    price_pence: price,
    title: "Adult lesson",
    level: "",
    blurb: "A private lesson in the school's open hours.",
    location: place.name,
    address: place.address,
    instructor: "Your teacher",
    enabled: 1,
    cancelled: 0,
  };
}

function busyRanges(db: DatabaseSync, nowIso: string, exceptBookingId?: string): Busy[] {
  const bookings = getRows<{ starts_at: string; ends_at: string; slot_id: string; user_id: string; id: string }>(
    db,
    `SELECT s.starts_at, s.ends_at, s.id AS slot_id, b.user_id, b.id
     FROM bookings b JOIN slots s ON s.id = b.slot_id
     WHERE b.id != ?
       AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > ?))`,
    exceptBookingId ?? "",
    nowIso,
  );
  const courses = getRows<{ starts_at: string; ends_at: string }>(
    db,
    `SELECT cs.starts_at, cs.ends_at
     FROM course_sessions cs JOIN course_runs cr ON cr.id = cs.run_id
     WHERE cr.enabled = 1 AND cr.cancelled = 0`,
  );
  return [
    ...bookings.map((row) => ({
      startMs: fromIso(row.starts_at).toMillis(),
      endMs: fromIso(row.ends_at).toMillis(),
      slotId: row.slot_id,
      userId: row.user_id,
      kind: "booking" as const,
    })),
    ...courses.map((row) => ({
      startMs: fromIso(row.starts_at).toMillis(),
      endMs: fromIso(row.ends_at).toMillis(),
      slotId: null,
      userId: null,
      kind: "course" as const,
    })),
  ];
}

function clashReason(busy: Busy[], startMs: number, endMs: number, slotId: string, userId: string | null): string | null {
  for (const range of busy) {
    if (range.slotId === slotId && userId && range.userId === userId) continue;
    if (startMs < range.endMs && endMs > range.startMs) {
      return range.kind === "course" ? "Overlaps a crash course." : "This time is already booked.";
    }
  }
  return null;
}

export function assertStoredSlotOpen(db: DatabaseSync, now: DateTime, slot: SlotRow, exceptBookingId?: string) {
  const parsed = parseOfferId(slot.id);
  if (parsed) {
    assertChoiceStillOpen(db, now, parsed, exceptBookingId);
    return;
  }
  const starts = fromIso(slot.starts_at);
  const block = getBookingBlock(starts, now);
  if (!block.ok) throw new AppError(400, block.code, block.message);
  const busy = busyRanges(db, toUtcIso(now), exceptBookingId);
  const clash = clashReason(busy, starts.toMillis(), fromIso(slot.ends_at).toMillis(), slot.id, null);
  if (clash) throw new AppError(409, "SLOT_OVERLAP", clash);
}

export function windowLabelFor(windows: WindowRow[]): string {
  return windows
    .map((window) => `${clockMinutesLabel(window.start_hour, window.start_minute)}–${clockMinutesLabel(window.end_hour, window.end_minute)}`)
    .join(", ");
}


