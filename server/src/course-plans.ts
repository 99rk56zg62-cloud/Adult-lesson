import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { COURSE_DAILY_MINUTES, COURSE_PACKAGE_PRICES } from "./availability.js";
import { getRows } from "./db.js";
import { AppError } from "./errors.js";
import { clockLabel, formatGBP } from "./format.js";
import { windowStarts, type WindowRow } from "./offers.js";
import { getBookingBlock, lastBookableDay } from "./rules.js";
import { fromIso, toUtcIso, ZONE } from "./time.js";

type CourseLength = 3 | 4 | 5;

export type SessionChoice = { dateKey: string; hour: number; minute: number };

export type PlannedSession = SessionChoice & {
  startsAt: string;
  endsAt: string;
  dayLabel: string;
  timeLabel: string;
};

export type CourseSuggestion = {
  label: string;
  sessions: PlannedSession[];
};

type Range = { startMs: number; endMs: number };

export function suggestCrashCourses(
  db: DatabaseSync,
  now: DateTime,
  input: { locationId: string; days: CourseLength },
): {
  days: CourseLength;
  dailyMinutes: number;
  pricePence: number;
  priceLabel: string;
  locationId: string;
  suggestions: CourseSuggestion[];
} {
  const matches = consecutiveRuns(db, now, input.locationId, input.days);
  const primary = matches[0];
  const suggestions: CourseSuggestion[] = [];
  if (primary) {
    suggestions.push({ label: runLabel(primary), sessions: primary });
    const nextTime = matches.find(
      (run) => run[0]!.hour !== primary[0]!.hour || run[0]!.minute !== primary[0]!.minute,
    );
    if (nextTime) suggestions.push({ label: `Next start time · ${runLabel(nextTime)}`, sessions: nextTime });
    const primaryDay = DateTime.fromISO(primary[0]!.dateKey, { zone: ZONE });
    const nextWeek = matches.find((run) => {
      if (run === primary || run === nextTime) return false;
      const day = DateTime.fromISO(run[0]!.dateKey, { zone: ZONE });
      return day >= primaryDay.plus({ days: 7 });
    });
    const fallback = nextWeek ?? matches.find((run) => run !== primary && run !== nextTime && run[0]!.dateKey !== primary[0]!.dateKey);
    if (fallback) suggestions.push({ label: `Another week · ${runLabel(fallback)}`, sessions: fallback });
  }
  return {
    days: input.days,
    dailyMinutes: COURSE_DAILY_MINUTES,
    pricePence: COURSE_PACKAGE_PRICES[input.days],
    priceLabel: formatGBP(COURSE_PACKAGE_PRICES[input.days]),
    locationId: input.locationId,
    suggestions,
  };
}

export function listCourseDayOptions(
  db: DatabaseSync,
  now: DateTime,
  input: { locationId: string; excludeDateKeys?: string[] },
): PlannedSession[] {
  const blocked = new Set(input.excludeDateKeys ?? []);
  const busy = busyRanges(db, toUtcIso(now));
  const windows = windowsFor(db, input.locationId);
  const start = now.setZone(ZONE).startOf("day");
  const end = lastBookableDay(now);
  const options: PlannedSession[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const dateKey = day.toFormat("yyyy-MM-dd");
    if (blocked.has(dateKey)) continue;
    for (const startAt of startsOnDay(day, windows)) {
      if (startAt.toMillis() <= now.toMillis()) continue;
      const session = describe(startAt);
      if (!getBookingBlock(startAt, now).ok) continue;
      if (overlaps(busy, session)) continue;
      options.push(session);
    }
  }
  return options;
}

export function assertCourseSessions(
  db: DatabaseSync,
  now: DateTime,
  input: { locationId: string; days: number; sessions: SessionChoice[]; exceptBookingId?: string },
): PlannedSession[] {
  if (input.days !== 3 && input.days !== 4 && input.days !== 5) {
    throw new AppError(400, "VALIDATION", "Crash courses are 3, 4, or 5 days.");
  }
  if (input.sessions.length !== input.days) {
    throw new AppError(400, "VALIDATION", `Choose exactly ${input.days} days.`);
  }
  const dates = new Set<string>();
  const resolved: PlannedSession[] = [];
  for (const choice of input.sessions) {
    if (dates.has(choice.dateKey)) {
      throw new AppError(400, "VALIDATION", "Each day of the course has to be a different date.");
    }
    dates.add(choice.dateKey);
    resolved.push(assertSessionOpen(db, now, input.locationId, choice, input.exceptBookingId));
  }
  resolved.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      if (overlaps([span(resolved[i]!)], resolved[j]!)) {
        throw new AppError(409, "SLOT_OVERLAP", "Those lessons overlap. Choose different times.");
      }
    }
  }
  return resolved;
}

export function assertSessionOpen(
  db: DatabaseSync,
  now: DateTime,
  locationId: string,
  choice: SessionChoice,
  exceptBookingId?: string,
): PlannedSession {
  if (choice.minute !== 0 && choice.minute !== 30) {
    throw new AppError(400, "VALIDATION", "Lessons start on the hour or half hour.");
  }
  const startAt = DateTime.fromISO(choice.dateKey, { zone: ZONE }).set({
    hour: choice.hour,
    minute: choice.minute,
    second: 0,
    millisecond: 0,
  });
  if (!startAt.isValid) throw new AppError(400, "VALIDATION", "Choose a valid day.");
  const block = getBookingBlock(startAt, now);
  if (!block.ok) throw new AppError(400, block.code, block.message);
  const windows = windowsFor(db, locationId).filter((window) => window.weekday === startAt.weekday);
  const startMin = choice.hour * 60 + choice.minute;
  const fits = windows.some((window) => {
    const open = window.start_hour * 60 + window.start_minute;
    const close = window.end_hour * 60 + window.end_minute;
    return startMin >= open && startMin + COURSE_DAILY_MINUTES <= close && (startMin - open) % 30 === 0;
  });
  if (!fits) throw new AppError(409, "OUTSIDE_WINDOW", "That lesson doesn't fit inside the available hours.");
  const session = describe(startAt);
  const busy = busyRanges(db, toUtcIso(now), exceptBookingId);
  if (overlaps(busy, session)) {
    throw new AppError(409, "SLOT_OVERLAP", "One of those days has just been booked. Choose another day.");
  }
  return session;
}

function consecutiveRuns(db: DatabaseSync, now: DateTime, locationId: string, days: number): PlannedSession[][] {
  const busy = busyRanges(db, toUtcIso(now));
  const windows = windowsFor(db, locationId);
  const start = now.setZone(ZONE).startOf("day");
  const end = lastBookableDay(now);
  const matches: PlannedSession[][] = [];
  for (let day = start; day.plus({ days: days - 1 }) <= end; day = day.plus({ days: 1 })) {
    const clocks = new Map<string, { hour: number; minute: number }>();
    for (const startAt of startsOnDay(day, windows)) {
      clocks.set(`${startAt.hour}:${startAt.minute}`, { hour: startAt.hour, minute: startAt.minute });
    }
    const ordered = [...clocks.values()].sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    for (const clock of ordered) {
      const sessions: PlannedSession[] = [];
      let ok = true;
      for (let offset = 0; offset < days; offset += 1) {
        const date = day.plus({ days: offset });
        const startAt = date.set({ hour: clock.hour, minute: clock.minute, second: 0, millisecond: 0 });
        if (startAt.toMillis() <= now.toMillis() || !getBookingBlock(startAt, now).ok) {
          ok = false;
          break;
        }
        if (!startsOnDay(date, windows).some((candidate) => candidate.hour === clock.hour && candidate.minute === clock.minute)) {
          ok = false;
          break;
        }
        const session = describe(startAt);
        if (overlaps(busy, session) || sessions.some((chosen) => overlaps([span(chosen)], session))) {
          ok = false;
          break;
        }
        sessions.push(session);
      }
      if (ok) matches.push(sessions);
    }
  }
  return matches;
}

function startsOnDay(day: DateTime, windows: WindowRow[]): DateTime[] {
  const starts: DateTime[] = [];
  for (const window of windows.filter((item) => item.weekday === day.weekday)) {
    const open = window.start_hour * 60 + window.start_minute;
    const close = window.end_hour * 60 + window.end_minute;
    for (const minutes of windowStarts(open, close, COURSE_DAILY_MINUTES)) {
      starts.push(day.set({ hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, millisecond: 0 }));
    }
  }
  return starts.sort((a, b) => a.toMillis() - b.toMillis());
}

function windowsFor(db: DatabaseSync, locationId: string): WindowRow[] {
  return getRows<WindowRow>(
    db,
    `SELECT * FROM availability_windows WHERE enabled = 1 AND location_id = ? ORDER BY weekday, start_hour, start_minute`,
    locationId,
  );
}

function busyRanges(db: DatabaseSync, nowIso: string, exceptBookingId?: string): Range[] {
  const lessons = getRows<{ starts_at: string; ends_at: string }>(
    db,
    `SELECT s.starts_at, s.ends_at
     FROM bookings b JOIN slots s ON s.id = b.slot_id
     WHERE b.id != ?
       AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > ?))`,
    exceptBookingId ?? "",
    nowIso,
  );
  const courses = getRows<{ starts_at: string; ends_at: string }>(
    db,
    `SELECT cs.starts_at, cs.ends_at
     FROM course_sessions cs
     JOIN bookings b ON b.course_run_id = cs.run_id
     WHERE b.id != ?
       AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > ?))`,
    exceptBookingId ?? "",
    nowIso,
  );
  return [...lessons, ...courses].map((row) => ({
    startMs: fromIso(row.starts_at).toMillis(),
    endMs: fromIso(row.ends_at).toMillis(),
  }));
}

function describe(startAt: DateTime): PlannedSession {
  const ends = startAt.plus({ minutes: COURSE_DAILY_MINUTES });
  return {
    dateKey: startAt.toFormat("yyyy-MM-dd"),
    hour: startAt.hour,
    minute: startAt.minute,
    startsAt: toUtcIso(startAt),
    endsAt: toUtcIso(ends),
    dayLabel: startAt.toFormat("cccc d LLLL"),
    timeLabel: `${clockLabel(startAt)}–${clockLabel(ends)}`,
  };
}

function span(session: PlannedSession): Range {
  return { startMs: fromIso(session.startsAt).toMillis(), endMs: fromIso(session.endsAt).toMillis() };
}

function overlaps(ranges: Range[], session: PlannedSession): boolean {
  const start = fromIso(session.startsAt).toMillis();
  const end = fromIso(session.endsAt).toMillis();
  return ranges.some((range) => start < range.endMs && end > range.startMs);
}

function runLabel(sessions: PlannedSession[]): string {
  const first = sessions[0]!;
  const last = sessions[sessions.length - 1]!;
  const sameTime = sessions.every((session) => session.hour === first.hour && session.minute === first.minute);
  const time = sameTime ? first.timeLabel : "mixed times";
  const consecutive = sessions.every((session, index) => {
    if (index === 0) return true;
    const previous = DateTime.fromISO(sessions[index - 1]!.dateKey, { zone: ZONE });
    const current = DateTime.fromISO(session.dateKey, { zone: ZONE });
    return current.diff(previous, "days").days === 1;
  });
  if (consecutive) {
    const start = DateTime.fromISO(first.dateKey, { zone: ZONE });
    const end = DateTime.fromISO(last.dateKey, { zone: ZONE });
    return `${start.toFormat("ccc d")}–${end.toFormat("ccc d LLL")} · ${time}`;
  }
  return `${sessions.map((session) => DateTime.fromISO(session.dateKey, { zone: ZONE }).toFormat("ccc d LLL")).join(", ")} · ${time}`;
}
