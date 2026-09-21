import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { hashPassword } from "./auth.js";
import { getRow } from "./db.js";
import { toUtcIso, ZONE } from "./time.js";

export const DEMO_EMAIL = "swimmer@example.com";
export const DEMO_PASSWORD = "Harbour-swim-1";
export const DEMO_NAME = "Demo Swimmer";

const HOLD_USER_ID = "user_capacity_hold";

type Rule = {
  id: string;
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
};

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

const WEEKLY_RULES: Rule[] = [
  rule("weekly-mon-1900", 1, 19, 0, 45, 8, 2800, "Adult beginners", "Beginners", BLURBS.beginners, "riverside", "Sam Okonkwo"),
  rule("weekly-tue-1830", 2, 18, 30, 45, 8, 2800, "Improvers", "Improvers", BLURBS.improvers, "riverside", "Priya Shah"),
  rule("weekly-wed-1215", 3, 12, 15, 45, 6, 2400, "Lunchtime lane skills", "Improvers", BLURBS.lunchtime, "harbour", "Helen Ward"),
  rule("weekly-thu-1900", 4, 19, 0, 45, 10, 2800, "Adult beginners", "Beginners", BLURBS.beginners, "harbour", "Sam Okonkwo"),
  rule("weekly-sat-0900", 6, 9, 0, 45, 8, 3000, "Water confidence", "Confidence", BLURBS.confidence, "riverside", "Helen Ward"),
  rule("weekly-sun-1000", 7, 10, 0, 60, 6, 3200, "Technique workshop", "Technique", BLURBS.technique, "harbour", "Priya Shah"),
];

function rule(
  id: string,
  weekday: number,
  hour: number,
  minute: number,
  durationMinutes: number,
  capacity: number,
  pricePence: number,
  title: string,
  level: string,
  blurb: string,
  place: keyof typeof PLACES,
  instructor: string,
): Rule {
  return { id, weekday, hour, minute, durationMinutes, capacity, pricePence, title, level, blurb, instructor, ...PLACES[place] };
}

const insertSlot = `
  INSERT OR IGNORE INTO slots (
    id, rule_id, starts_at, ends_at, capacity, price_pence, title, level, blurb, location, address, instructor
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export function seedDatabase(
  db: DatabaseSync,
  clock: () => DateTime,
  options: { demo: boolean; bcryptRounds: number },
) {
  const now = clock();
  const nowIso = toUtcIso(now);
  materializeWeekly(db, now);
  ensureSoonSlot(db, now, nowIso);
  ensureFullSlot(db, now, nowIso, options.bcryptRounds);
  if (options.demo) {
    ensureDemoBooking(db, now, nowIso, options.bcryptRounds);
  }
}

function materializeWeekly(db: DatabaseSync, now: DateTime) {
  const startDay = now.setZone(ZONE).startOf("day");
  const endDay = startDay.plus({ weeks: 8 });
  const insert = db.prepare(insertSlot);
  for (let day = startDay; day <= endDay; day = day.plus({ days: 1 })) {
    for (const item of WEEKLY_RULES) {
      if (day.weekday !== item.weekday) continue;
      const starts = day.set({ hour: item.hour, minute: item.minute, second: 0, millisecond: 0 });
      if (starts.toMillis() <= now.toMillis()) continue;
      insert.run(
        randomUUID(),
        item.id,
        toUtcIso(starts),
        toUtcIso(starts.plus({ minutes: item.durationMinutes })),
        item.capacity,
        item.pricePence,
        item.title,
        item.level,
        item.blurb,
        item.location,
        item.address,
        item.instructor,
      );
    }
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
  const template = WEEKLY_RULES[0]!;
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
