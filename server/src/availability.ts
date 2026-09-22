import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { getRow, getRows } from "./db.js";
import { toUtcIso, ZONE } from "./time.js";
import type { AvailabilityRuleRow } from "./types.js";

export const WEEKDAY_LABELS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const MATERIALIZE_WEEKS = 8;

const insertSlotSql = `
  INSERT INTO slots (
    id, rule_id, starts_at, ends_at, capacity, price_pence, title, level, blurb, location, address, instructor, enabled, cancelled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
  ON CONFLICT(rule_id, starts_at) DO UPDATE SET
    ends_at = excluded.ends_at,
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
  weekday: number;
  hour: number;
  minute: number;
  durationMinutes: number;
  capacity: number;
  pricePence: number;
  title: string;
  level: string;
  blurb: string;
  location: string;
  address: string;
  instructor: string;
  enabled?: boolean;
};

export function materializeEnabledRules(db: DatabaseSync, now: DateTime, weeks = MATERIALIZE_WEEKS) {
  const rules = getRows<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE enabled = 1`);
  for (const rule of rules) materializeRule(db, rule, now, weeks);
}

export function materializeRule(db: DatabaseSync, rule: AvailabilityRuleRow, now: DateTime, weeks = MATERIALIZE_WEEKS) {
  if (!rule.enabled) {
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
      toUtcIso(starts),
      toUtcIso(starts.plus({ minutes: rule.duration_minutes })),
      rule.capacity,
      rule.price_pence,
      rule.title,
      rule.level,
      rule.blurb,
      rule.location,
      rule.address,
      rule.instructor,
    );
  }
}

export function disableFutureRuleSlots(db: DatabaseSync, ruleId: string, now: DateTime) {
  db.prepare(`UPDATE slots SET enabled = 0 WHERE rule_id = ? AND starts_at > ?`).run(ruleId, toUtcIso(now));
}

export function upsertRule(db: DatabaseSync, id: string, input: RuleInput, now: DateTime): AvailabilityRuleRow {
  const stamp = toUtcIso(now);
  const existing = getRow<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE id = ?`, id);
  const enabled = input.enabled === false ? 0 : 1;
  if (existing) {
    db.prepare(
      `UPDATE availability_rules SET
        weekday = ?, hour = ?, minute = ?, duration_minutes = ?, capacity = ?, price_pence = ?,
        title = ?, level = ?, blurb = ?, location = ?, address = ?, instructor = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.weekday,
      input.hour,
      input.minute,
      input.durationMinutes,
      input.capacity,
      input.pricePence,
      input.title,
      input.level,
      input.blurb,
      input.location,
      input.address,
      input.instructor,
      enabled,
      stamp,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO availability_rules (
        id, weekday, hour, minute, duration_minutes, capacity, price_pence,
        title, level, blurb, location, address, instructor, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.weekday,
      input.hour,
      input.minute,
      input.durationMinutes,
      input.capacity,
      input.pricePence,
      input.title,
      input.level,
      input.blurb,
      input.location,
      input.address,
      input.instructor,
      enabled,
      stamp,
      stamp,
    );
  }

  const previousStarts = existing
    ? getRows<{ starts_at: string }>(
        db,
        `SELECT starts_at FROM slots WHERE rule_id = ? AND starts_at > ?`,
        id,
        stamp,
      ).map((row) => row.starts_at)
    : [];

  if (existing && (existing.weekday !== input.weekday || existing.hour !== input.hour || existing.minute !== input.minute)) {
    // Old times no longer match the rule — hide unbooked future copies.
    for (const startsAt of previousStarts) {
      const occupied = getRow<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM bookings
         WHERE slot_id = (SELECT id FROM slots WHERE rule_id = ? AND starts_at = ?)
           AND status IN ('pending_payment', 'confirmed')`,
        id,
        startsAt,
      );
      if (Number(occupied?.n ?? 0) === 0) {
        db.prepare(`UPDATE slots SET enabled = 0 WHERE rule_id = ? AND starts_at = ?`).run(id, startsAt);
      }
    }
  }

  const rule = getRow<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE id = ?`, id)!;
  materializeRule(db, rule, now);
  return rule;
}

export function clockMinutesLabel(hour: number, minute: number): string {
  const local = DateTime.fromObject({ hour, minute }, { zone: ZONE });
  return `${local.toFormat("h:mm")}${local.toFormat("a").toLowerCase()}`;
}
