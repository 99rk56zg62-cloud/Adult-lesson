import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { getRow, getRows } from "./db.js";
import { toUtcIso, ZONE } from "./time.js";
import type { AvailabilityRuleRow, LocationRow } from "./types.js";

export const WEEKDAY_LABELS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const LESSON_DURATIONS = [30, 60] as const;
export const COURSE_LENGTHS = [3, 4, 5] as const;
export const COURSE_DAILY_MINUTES = 90;
export const COURSE_MORNING_START_HOUR = 6;
export const COURSE_MORNING_END_HOUR = 9;
export const MATERIALIZE_WEEKS = 8;

const insertSlotSql = `
  INSERT INTO slots (
    id, rule_id, location_id, starts_at, ends_at, duration_minutes, capacity, price_pence,
    title, level, blurb, location, address, instructor, enabled, cancelled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
  ON CONFLICT(rule_id, starts_at) DO UPDATE SET
    location_id = excluded.location_id,
    ends_at = excluded.ends_at,
    duration_minutes = excluded.duration_minutes,
    capacity = excluded.capacity,
    price_pence = excluded.price_pence,
    title = excluded.title,
    level = excluded.level,
    blurb = excluded.blurb,
    location = excluded.location,
    address = excluded.address,
    instructor = excluded.instructor
`;

export type RuleInput = {
  locationId: string;
  weekday: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  capacity: number;
  pricePence: number;
  title: string;
  level: string;
  blurb: string;
  instructor: string;
  enabled?: boolean;
};

export function assertLessonDuration(minutes: number) {
  if (!(LESSON_DURATIONS as readonly number[]).includes(minutes)) {
    throw new Error("Single lessons are 30 or 60 minutes only.");
  }
}

export function assertCourseDays(days: number) {
  if (!(COURSE_LENGTHS as readonly number[]).includes(days)) {
    throw new Error("Crash courses are 3, 4, or 5 days.");
  }
}

export function assertMorningWindow(hour: number, minute: number) {
  const start = hour * 60 + minute;
  const windowStart = COURSE_MORNING_START_HOUR * 60;
  const windowEnd = COURSE_MORNING_END_HOUR * 60;
  // Allow starting from 06:00 inclusive through 09:00 inclusive (session may extend past 09:00).
  if (start < windowStart || start > windowEnd) {
    throw new Error("Crash course daily start times should be between 06:00 and 09:00 UK time.");
  }
}

export function materializeEnabledRules(db: DatabaseSync, now: DateTime, weeks = MATERIALIZE_WEEKS) {
  const rules = getRows<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE enabled = 1`);
  for (const rule of rules) materializeRule(db, rule, now, weeks);
}

export function materializeRule(db: DatabaseSync, rule: AvailabilityRuleRow, now: DateTime, weeks = MATERIALIZE_WEEKS) {
  if (!rule.enabled) {
    disableFutureRuleSlots(db, rule.id, now);
    return;
  }
  const place = getRow<LocationRow>(db, `SELECT * FROM locations WHERE id = ?`, rule.location_id);
  if (!place || !place.enabled) {
    disableFutureRuleSlots(db, rule.id, now);
    return;
  }
  const startDay = now.setZone(ZONE).startOf("day");
  const endDay = startDay.plus({ weeks });
  const insert = db.prepare(insertSlotSql);
  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    if (day.weekday !== rule.weekday) continue;
    const starts = day.set({ hour: rule.hour, minute: rule.minute, second: 0, millisecond: 0 });
    if (starts.toMillis() <= now.toMillis()) continue;
    insert.run(
      randomUUID(),
      rule.id,
      rule.location_id,
      toUtcIso(starts),
      toUtcIso(starts.plus({ minutes: rule.duration_minutes })),
      rule.duration_minutes,
      rule.capacity,
      rule.price_pence,
      rule.title,
      rule.level,
      rule.blurb,
      place.name,
      place.address,
      rule.instructor,
    );
  }
}

export function disableFutureRuleSlots(db: DatabaseSync, ruleId: string, now: DateTime) {
  db.prepare(`UPDATE slots SET enabled = 0 WHERE rule_id = ? AND starts_at > ?`).run(ruleId, toUtcIso(now));
}

export function upsertRule(db: DatabaseSync, id: string, input: RuleInput, now: DateTime): AvailabilityRuleRow {
  assertLessonDuration(input.durationMinutes);
  const stamp = toUtcIso(now);
  const existing = getRow<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE id = ?`, id);
  const enabled = input.enabled === false ? 0 : 1;
  if (existing) {
    db.prepare(
      `UPDATE availability_rules SET
        location_id = ?, weekday = ?, hour = ?, minute = ?, duration_minutes = ?, capacity = ?, price_pence = ?,
        title = ?, level = ?, blurb = ?, instructor = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.locationId,
      input.weekday,
      input.hour,
      input.minute,
      input.durationMinutes,
      input.capacity,
      input.pricePence,
      input.title,
      input.level,
      input.blurb,
      input.instructor,
      enabled,
      stamp,
      id,
    );
    if (
      existing.weekday !== input.weekday ||
      existing.hour !== input.hour ||
      existing.minute !== input.minute ||
      existing.duration_minutes !== input.durationMinutes ||
      existing.location_id !== input.locationId
    ) {
      const future = getRows<{ id: string; starts_at: string }>(
        db,
        `SELECT id, starts_at FROM slots WHERE rule_id = ? AND starts_at > ?`,
        id,
        stamp,
      );
      for (const slot of future) {
        const held = getRow<{ n: number }>(
          db,
          `SELECT COUNT(*) AS n FROM bookings
           WHERE slot_id = ? AND status IN ('pending_payment', 'confirmed')`,
          slot.id,
        );
        if (Number(held?.n ?? 0) === 0) {
          db.prepare(`UPDATE slots SET enabled = 0 WHERE id = ?`).run(slot.id);
        }
      }
    }
  } else {
    db.prepare(
      `INSERT INTO availability_rules (
        id, location_id, weekday, hour, minute, duration_minutes, capacity, price_pence,
        title, level, blurb, instructor, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.locationId,
      input.weekday,
      input.hour,
      input.minute,
      input.durationMinutes,
      input.capacity,
      input.pricePence,
      input.title,
      input.level,
      input.blurb,
      input.instructor,
      enabled,
      stamp,
      stamp,
    );
  }
  const rule = getRow<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE id = ?`, id)!;
  materializeRule(db, rule, now);
  return rule;
}

export function clockMinutesLabel(hour: number, minute: number): string {
  const local = DateTime.fromObject({ hour, minute }, { zone: ZONE });
  return `${local.toFormat("h:mm")}${local.toFormat("a").toLowerCase()}`;
}

export function materializeCourseRun(db: DatabaseSync, runId: string) {
  const run = getRow<CourseRunRowLike>(db, `SELECT * FROM course_runs WHERE id = ?`, runId);
  if (!run) return;
  db.prepare(`DELETE FROM course_sessions WHERE run_id = ?`).run(runId);
  const insert = db.prepare(
    `INSERT INTO course_sessions (id, run_id, day_index, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const first = DateTime.fromISO(run.first_date, { zone: ZONE }).startOf("day");
  for (let index = 0; index < run.days; index += 1) {
    const day = first.plus({ days: index });
    const starts = day.set({ hour: run.daily_hour, minute: run.daily_minute, second: 0, millisecond: 0 });
    insert.run(randomUUID(), runId, index + 1, toUtcIso(starts), toUtcIso(starts.plus({ minutes: run.daily_minutes })));
  }
}

type CourseRunRowLike = {
  id: string;
  first_date: string;
  daily_hour: number;
  daily_minute: number;
  days: number;
  daily_minutes: number;
};
