import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { hashPassword } from "./auth.js";
import { materializeEnabledRules, upsertRule } from "./availability.js";
import { getRow } from "./db.js";
import { toUtcIso, ZONE } from "./time.js";

export const DEMO_EMAIL = "swimmer@example.com";
export const DEMO_PASSWORD = "Harbour-swim-1";
export const DEMO_NAME = "Demo Swimmer";

const HOLD_USER_ID = "user_capacity_hold";

const PLACES = {
  riverside: { location: "Riverside Lido", address: "Pool Lane, Bristol" },
  harbour: { location: "Harbour Pool", address: "Wharf Road, Bristol" },
} as const;

const BLURBS = {
  beginners:
    "For adults new to the water, or coming back after a long break. We'll work on feeling safe, breathing out, and a first stroke.",
  improvers:
    "You can already swim a length. This session builds a calmer front crawl and backstroke, with time to ask questions.",
  lunchtime:
    "A midweek session for adults who can swim a length and want a cleaner, less tiring stroke.",
  confidence: "A gentle session on floating, breathing, and moving through the water without rushing.",
  technique: "Drill-led workshop for adults who already swim regularly and want easier, smoother laps.",
};

const DEFAULT_RULES = [
  {
    id: "weekly-mon-1900",
    weekday: 1,
    hour: 19,
    minute: 0,
    durationMinutes: 45,
    capacity: 8,
    pricePence: 2800,
    title: "Adult beginners",
    level: "Beginners",
    blurb: BLURBS.beginners,
    ...PLACES.riverside,
    instructor: "Sam Okonkwo",
  },
  {
    id: "weekly-tue-1830",
    weekday: 2,
    hour: 18,
    minute: 30,
    durationMinutes: 45,
    capacity: 8,
    pricePence: 2800,
    title: "Improvers",
    level: "Improvers",
    blurb: BLURBS.improvers,
    ...PLACES.riverside,
    instructor: "Priya Shah",
  },
  {
    id: "weekly-wed-1215",
    weekday: 3,
    hour: 12,
    minute: 15,
    durationMinutes: 45,
    capacity: 6,
    pricePence: 2400,
    title: "Lunchtime lane skills",
    level: "Improvers",
    blurb: BLURBS.lunchtime,
    ...PLACES.harbour,
    instructor: "Helen Ward",
  },
  {
    id: "weekly-thu-1900",
    weekday: 4,
    hour: 19,
    minute: 0,
    durationMinutes: 45,
    capacity: 10,
    pricePence: 2800,
    title: "Adult beginners",
    level: "Beginners",
    blurb: BLURBS.beginners,
    ...PLACES.harbour,
    instructor: "Sam Okonkwo",
  },
  {
    id: "weekly-sat-0900",
    weekday: 6,
    hour: 9,
    minute: 0,
    durationMinutes: 45,
    capacity: 8,
    pricePence: 3000,
    title: "Water confidence",
    level: "Confidence",
    blurb: BLURBS.confidence,
    ...PLACES.riverside,
    instructor: "Helen Ward",
  },
  {
    id: "weekly-sun-1000",
    weekday: 7,
    hour: 10,
    minute: 0,
    durationMinutes: 60,
    capacity: 6,
    pricePence: 3200,
    title: "Technique workshop",
    level: "Technique",
    blurb: BLURBS.technique,
    ...PLACES.harbour,
    instructor: "Priya Shah",
  },
] as const;

const insertSlot = `
  INSERT OR IGNORE INTO slots (
    id, rule_id, starts_at, ends_at, capacity, price_pence, title, level, blurb, location, address, instructor, enabled, cancelled
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
`;

export function seedDatabase(
  db: DatabaseSync,
  clock: () => DateTime,
  options: { demo: boolean; bcryptRounds: number },
) {
  const now = clock();
  const nowIso = toUtcIso(now);
  seedDefaultRules(db, now);
  materializeEnabledRules(db, now);
  ensureSoonSlot(db, now, nowIso);
  ensureFullSlot(db, now, nowIso, options.bcryptRounds);
  if (options.demo) {
    ensureDemoBooking(db, now, nowIso, options.bcryptRounds);
  }
}

function seedDefaultRules(db: DatabaseSync, now: DateTime) {
  for (const item of DEFAULT_RULES) {
    const existing = getRow<{ id: string }>(db, `SELECT id FROM availability_rules WHERE id = ?`, item.id);
    if (existing) continue;
    upsertRule(
      db,
      item.id,
      {
        weekday: item.weekday,
        hour: item.hour,
        minute: item.minute,
        durationMinutes: item.durationMinutes,
        capacity: item.capacity,
        pricePence: item.pricePence,
        title: item.title,
        level: item.level,
        blurb: item.blurb,
        location: item.location,
        address: item.address,
        instructor: item.instructor,
        enabled: true,
      },
      now,
    );
  }
}

function ensureSoonSlot(db: DatabaseSync, now: DateTime, nowIso: string) {
  const existing = getRow<{ id: string }>(
    db,
    `SELECT id FROM slots WHERE rule_id = 'soon-dropin' AND starts_at > ?`,
    nowIso,
  );
  if (existing) return;
  const starts = now.setZone(ZONE).plus({ hours: 12 }).startOf("hour");
  const template = DEFAULT_RULES[0]!;
  db.prepare(insertSlot).run(
    randomUUID(),
    "soon-dropin",
    toUtcIso(starts),
    toUtcIso(starts.plus({ minutes: 45 })),
    8,
    2800,
    "Adult beginners",
    "Beginners",
    template.blurb,
    template.location,
    template.address,
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
  const starts = now.setZone(ZONE).plus({ days: 5 }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const slotId = randomUUID();
  db.prepare(insertSlot).run(
    slotId,
    "showcase-full",
    toUtcIso(starts),
    toUtcIso(starts.plus({ minutes: 60 })),
    1,
    3200,
    "Stroke workshop",
    "Technique",
    BLURBS.technique,
    PLACES.harbour.location,
    PLACES.harbour.address,
    "Priya Shah",
  );
  ensureUser(db, HOLD_USER_ID, "holds@lido.invalid", "Capacity hold", hashPassword(randomBytes(18).toString("hex"), rounds), now);
  insertConfirmed(db, HOLD_USER_ID, slotId, 3200, now, "seed");
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
     JOIN slots s ON s.id = b.slot_id
     WHERE b.user_id = ? AND b.status = 'confirmed' AND s.starts_at > ?`,
    userId,
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
  insertConfirmed(db, userId, slot.id, slot.price_pence, now, "seed");
}

function ensureUser(db: DatabaseSync, id: string, email: string, name: string, passwordHash: string, now: DateTime): string {
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, email, name, passwordHash, toUtcIso(now));
  const row = getRow<{ id: string }>(db, `SELECT id FROM users WHERE email = ?`, email);
  if (!row) throw new Error(`Failed to seed user ${email}`);
  return row.id;
}

function insertConfirmed(
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
      id, reference, user_id, slot_id, status, hold_expires_at, price_pence,
      stripe_session_id, stripe_payment_intent, payment_source, return_url,
      calendar_event_id, created_at, confirmed_at, rescheduled_at
    ) VALUES (?, ?, ?, ?, 'confirmed', NULL, ?, NULL, NULL, ?, NULL, NULL, ?, ?, NULL)`,
  ).run(randomUUID(), makeReference(), userId, slotId, pricePence, source, stamp, stamp);
}

function makeReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "LD-";
  for (const byte of bytes) code += alphabet[byte % alphabet.length]!;
  return code;
}
