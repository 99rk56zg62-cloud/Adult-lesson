import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { hashPassword } from "./auth.js";
import {
  COURSE_DAILY_MINUTES,
  materializeCourseRun,
  materializeEnabledRules,
  upsertRule,
} from "./availability.js";
import { getRow } from "./db.js";
import { toUtcIso, ZONE } from "./time.js";

export const DEMO_EMAIL = "swimmer@example.com";
export const DEMO_PASSWORD = "Harbour-swim-1";
export const DEMO_NAME = "Demo Swimmer";

export const FAREHAM_LOCATION_ID = "loc_fareham_west_street";

const HOLD_USER_ID = "user_capacity_hold";

const BLURBS = {
  beginners:
    "For adults new to the water, or coming back after a long break. We'll work on feeling safe, breathing out, and a first stroke.",
  improvers:
    "You can already swim a length. This session builds a calmer front crawl and backstroke, with time to ask questions.",
  lunchtime:
    "A midweek session for adults who can swim a length and want a cleaner, less tiring stroke.",
  confidence: "A gentle session on floating, breathing, and moving through the water without rushing.",
  technique: "Drill-led workshop for adults who already swim regularly and want easier, smoother laps.",
  crash3:
    "Three mornings in a row to build water confidence and a first stroke. Each day is 90 minutes with the same teacher.",
  crash4:
    "Four consecutive mornings to tidy front crawl and backstroke. Ideal if you can already swim a short distance.",
  crash5:
    "Five mornings of focused technique work. For adults who swim regularly and want smoother, less tiring laps.",
};

const DEFAULT_RULES = [
  {
    id: "weekly-mon-1900-30",
    weekday: 1,
    hour: 19,
    minute: 0,
    durationMinutes: 30,
    capacity: 8,
    pricePence: 2200,
    title: "Adult beginners",
    level: "Beginners",
    blurb: BLURBS.beginners,
    instructor: "Sam Okonkwo",
  },
  {
    id: "weekly-tue-1830-60",
    weekday: 2,
    hour: 18,
    minute: 30,
    durationMinutes: 60,
    capacity: 8,
    pricePence: 3200,
    title: "Improvers",
    level: "Improvers",
    blurb: BLURBS.improvers,
    instructor: "Priya Shah",
  },
  {
    id: "weekly-wed-1215-30",
    weekday: 3,
    hour: 12,
    minute: 15,
    durationMinutes: 30,
    capacity: 6,
    pricePence: 2000,
    title: "Lunchtime lane skills",
    level: "Improvers",
    blurb: BLURBS.lunchtime,
    instructor: "Helen Ward",
  },
  {
    id: "weekly-thu-1900-60",
    weekday: 4,
    hour: 19,
    minute: 0,
    durationMinutes: 60,
    capacity: 10,
    pricePence: 3200,
    title: "Adult beginners",
    level: "Beginners",
    blurb: BLURBS.beginners,
    instructor: "Sam Okonkwo",
  },
  {
    id: "weekly-sat-0900-30",
    weekday: 6,
    hour: 9,
    minute: 0,
    durationMinutes: 30,
    capacity: 8,
    pricePence: 2400,
    title: "Water confidence",
    level: "Confidence",
    blurb: BLURBS.confidence,
    instructor: "Helen Ward",
  },
  {
    id: "weekly-sun-1000-60",
    weekday: 7,
    hour: 10,
    minute: 0,
    durationMinutes: 60,
    capacity: 6,
    pricePence: 3600,
    title: "Technique workshop",
    level: "Technique",
    blurb: BLURBS.technique,
    instructor: "Priya Shah",
  },
] as const;

const COURSE_PRODUCTS = [
  {
    id: "course-prod-3-beginners",
    days: 3,
    capacity: 6,
    pricePence: 9900,
    title: "3-day crash course",
    level: "Beginners",
    blurb: BLURBS.crash3,
    instructor: "Sam Okonkwo",
  },
  {
    id: "course-prod-4-improvers",
    days: 4,
    capacity: 6,
    pricePence: 12900,
    title: "4-day crash course",
    level: "Improvers",
    blurb: BLURBS.crash4,
    instructor: "Priya Shah",
  },
  {
    id: "course-prod-5-technique",
    days: 5,
    capacity: 5,
    pricePence: 15900,
    title: "5-day crash course",
    level: "Technique",
    blurb: BLURBS.crash5,
    instructor: "Helen Ward",
  },
] as const;

const insertSlot = `
  INSERT OR IGNORE INTO slots (
    id, rule_id, location_id, starts_at, ends_at, duration_minutes, capacity, price_pence,
    title, level, blurb, location, address, instructor, enabled, cancelled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
`;

export function seedDatabase(
  db: DatabaseSync,
  clock: () => DateTime,
  options: { demo: boolean; bcryptRounds: number },
) {
  const now = clock();
  const nowIso = toUtcIso(now);
  ensureFarehamLocation(db, now);
  seedDefaultRules(db, now);
  materializeEnabledRules(db, now);
  seedCourseProducts(db, now);
  seedCourseRuns(db, now);
  ensureSoonSlot(db, now, nowIso);
  ensureFullSlot(db, now, nowIso, options.bcryptRounds);
  if (options.demo) {
    ensureDemoBooking(db, now, nowIso, options.bcryptRounds);
  }
}

function ensureFarehamLocation(db: DatabaseSync, now: DateTime) {
  const stamp = toUtcIso(now);
  db.prepare(
    `INSERT OR IGNORE INTO locations (id, name, address, enabled, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(FAREHAM_LOCATION_ID, "West Street Fareham", "153 West Street, Fareham PO16 0EL", stamp, stamp);
}

function seedDefaultRules(db: DatabaseSync, now: DateTime) {
  for (const item of DEFAULT_RULES) {
    const existing = getRow<{ id: string }>(db, `SELECT id FROM availability_rules WHERE id = ?`, item.id);
    if (existing) continue;
    upsertRule(
      db,
      item.id,
      {
        locationId: FAREHAM_LOCATION_ID,
        weekday: item.weekday,
        hour: item.hour,
        minute: item.minute,
        durationMinutes: item.durationMinutes,
        capacity: item.capacity,
        pricePence: item.pricePence,
        title: item.title,
        level: item.level,
        blurb: item.blurb,
        instructor: item.instructor,
        enabled: true,
      },
      now,
    );
  }
}

function seedCourseProducts(db: DatabaseSync, now: DateTime) {
  const stamp = toUtcIso(now);
  for (const product of COURSE_PRODUCTS) {
    db.prepare(
      `INSERT OR IGNORE INTO course_products (
        id, location_id, days, daily_minutes, capacity, price_pence,
        title, level, blurb, instructor, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      product.id,
      FAREHAM_LOCATION_ID,
      product.days,
      COURSE_DAILY_MINUTES,
      product.capacity,
      product.pricePence,
      product.title,
      product.level,
      product.blurb,
      product.instructor,
      stamp,
      stamp,
    );
  }
}

function seedCourseRuns(db: DatabaseSync, now: DateTime) {
  const place = getRow<{ name: string; address: string }>(
    db,
    `SELECT name, address FROM locations WHERE id = ?`,
    FAREHAM_LOCATION_ID,
  );
  if (!place) return;

  const runs = [
    {
      id: "course-run-3",
      productId: "course-prod-3-beginners",
      days: 3,
      dailyHour: 7,
      dailyMinute: 0,
      offsetDays: 10,
    },
    {
      id: "course-run-4",
      productId: "course-prod-4-improvers",
      days: 4,
      dailyHour: 7,
      dailyMinute: 30,
      offsetDays: 18,
    },
    {
      id: "course-run-5",
      productId: "course-prod-5-technique",
      days: 5,
      dailyHour: 8,
      dailyMinute: 0,
      offsetDays: 28,
    },
  ] as const;

  for (const run of runs) {
    const existing = getRow<{ id: string }>(db, `SELECT id FROM course_runs WHERE id = ?`, run.id);
    if (existing) continue;
    const product = getRow<{
      title: string;
      level: string;
      blurb: string;
      instructor: string;
      capacity: number;
      price_pence: number;
    }>(db, `SELECT title, level, blurb, instructor, capacity, price_pence FROM course_products WHERE id = ?`, run.productId);
    if (!product) continue;
    const firstDate = now.setZone(ZONE).plus({ days: run.offsetDays }).startOf("day");
    db.prepare(
      `INSERT INTO course_runs (
        id, product_id, location_id, first_date, daily_hour, daily_minute, days, daily_minutes,
        capacity, price_pence, title, level, blurb, instructor, location, address, enabled, cancelled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
    ).run(
      run.id,
      run.productId,
      FAREHAM_LOCATION_ID,
      firstDate.toFormat("yyyy-MM-dd"),
      run.dailyHour,
      run.dailyMinute,
      run.days,
      COURSE_DAILY_MINUTES,
      product.capacity,
      product.price_pence,
      product.title,
      product.level,
      product.blurb,
      product.instructor,
      place.name,
      place.address,
      toUtcIso(now),
    );
    materializeCourseRun(db, run.id);
  }
}

function ensureSoonSlot(db: DatabaseSync, now: DateTime, nowIso: string) {
  const existing = getRow<{ id: string }>(
    db,
    `SELECT id FROM slots WHERE rule_id = 'soon-dropin' AND starts_at > ?`,
    nowIso,
  );
  if (existing) return;
  const place = getRow<{ name: string; address: string }>(
    db,
    `SELECT name, address FROM locations WHERE id = ?`,
    FAREHAM_LOCATION_ID,
  );
  if (!place) return;
  const starts = now.setZone(ZONE).plus({ hours: 12 }).startOf("hour");
  const template = DEFAULT_RULES[0]!;
  db.prepare(insertSlot).run(
    randomUUID(),
    "soon-dropin",
    FAREHAM_LOCATION_ID,
    toUtcIso(starts),
    toUtcIso(starts.plus({ minutes: 30 })),
    30,
    8,
    2200,
    "Adult beginners",
    "Beginners",
    template.blurb,
    place.name,
    place.address,
    template.instructor,
  );
}

function ensureFullSlot(db: DatabaseSync, now: DateTime, nowIso: string, rounds: number) {
  const existing = getRow<{ id: string }>(
    db,
    `SELECT id FROM slots WHERE rule_id = 'showcase-full' AND starts_at > ?`,
    nowIso,
  );
  if (existing) return;
  const place = getRow<{ name: string; address: string }>(
    db,
    `SELECT name, address FROM locations WHERE id = ?`,
    FAREHAM_LOCATION_ID,
  );
  if (!place) return;
  const starts = now.setZone(ZONE).plus({ days: 5 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const slotId = randomUUID();
  db.prepare(insertSlot).run(
    slotId,
    "showcase-full",
    FAREHAM_LOCATION_ID,
    toUtcIso(starts),
    toUtcIso(starts.plus({ minutes: 60 })),
    60,
    1,
    3200,
    "Stroke workshop",
    "Technique",
    BLURBS.technique,
    place.name,
    place.address,
    "Priya Shah",
  );
  ensureUser(db, HOLD_USER_ID, "holds@lido.invalid", "Capacity hold", hashPassword(randomBytes(18).toString("hex"), rounds), now);
  insertConfirmedLesson(db, HOLD_USER_ID, slotId, 3200, now, "seed");
}

function ensureDemoBooking(db: DatabaseSync, now: DateTime, nowIso: string, rounds: number) {
  const userId = ensureUser(
    db,
    "user_demo_swimmer",
    DEMO_EMAIL,
    DEMO_NAME,
    hashPassword(DEMO_PASSWORD, rounds),
    now,
  );
  const upcoming = getRow<{ id: string }>(
    db,
    `SELECT b.id FROM bookings b
     LEFT JOIN slots s ON s.id = b.slot_id
     LEFT JOIN course_runs cr ON cr.id = b.course_run_id
     LEFT JOIN course_sessions cs ON cs.run_id = cr.id AND cs.day_index = 1
     WHERE b.user_id = ? AND b.status = 'confirmed'
       AND (
         (b.kind = 'lesson' AND s.starts_at > ?)
         OR (b.kind = 'course' AND cs.starts_at > ?)
       )`,
    userId,
    nowIso,
    nowIso,
  );
  if (upcoming) return;
  const earliest = toUtcIso(now.plus({ days: 2 }));
  const latest = toUtcIso(now.plus({ days: 12 }));
  const slot = getRow<{ id: string; price_pence: number }>(
    db,
    `SELECT s.id, s.price_pence FROM slots s
     WHERE s.rule_id LIKE 'weekly-%'
       AND s.level = 'Beginners'
       AND s.duration_minutes = 30
       AND s.enabled = 1
       AND s.cancelled = 0
       AND s.starts_at > ?
       AND s.starts_at < ?
       AND (
         SELECT COUNT(*) FROM bookings b
         WHERE b.slot_id = s.id
           AND (b.status = 'confirmed' OR (b.status = 'pending_payment' AND b.hold_expires_at > ?))
       ) < s.capacity - 1
     ORDER BY s.starts_at
     LIMIT 1`,
    earliest,
    latest,
    nowIso,
  );
  if (!slot) return;
  insertConfirmedLesson(db, userId, slot.id, slot.price_pence, now, "seed");
}

function ensureUser(db: DatabaseSync, id: string, email: string, name: string, passwordHash: string, now: DateTime): string {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, name, passwordHash, toUtcIso(now));
  const row = getRow<{ id: string }>(db, `SELECT id FROM users WHERE email = ?`, email);
  if (!row) throw new Error(`Failed to seed user ${email}`);
  return row.id;
}

function insertConfirmedLesson(
  db: DatabaseSync,
  userId: string,
  slotId: string,
  pricePence: number,
  now: DateTime,
  source: string,
) {
  const stamp = toUtcIso(now);
  db.prepare(
    `INSERT INTO bookings (
      id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
      stripe_session_id, stripe_payment_intent, payment_source, return_url,
      calendar_event_id, created_at, confirmed_at, rescheduled_at
    ) VALUES (?, ?, ?, 'lesson', ?, NULL, 'confirmed', NULL, ?, NULL, NULL, ?, NULL, NULL, ?, ?, NULL)`,
  ).run(randomUUID(), makeReference(), userId, slotId, pricePence, source, stamp, stamp);
}

function makeReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "LD-";
  for (const byte of bytes) code += alphabet[byte % alphabet.length]!;
  return code;
}
