import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export function openDatabase(filename: string): DatabaseSync {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 3000");
  if (filename !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL");
  }
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      google_refresh_token TEXT,
      google_email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS locations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS availability_rules (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      hour INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      price_pence INTEGER NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      blurb TEXT NOT NULL,
      instructor TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      location_id TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      price_pence INTEGER NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      blurb TEXT NOT NULL,
      location TEXT NOT NULL,
      address TEXT NOT NULL,
      instructor TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cancelled INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS slots_rule_start ON slots(rule_id, starts_at);
    CREATE INDEX IF NOT EXISTS slots_location_start ON slots(location_id, starts_at);
    CREATE INDEX IF NOT EXISTS slots_duration_start ON slots(duration_minutes, starts_at);

    CREATE TABLE IF NOT EXISTS course_products (
      id TEXT PRIMARY KEY,
      location_id TEXT NOT NULL,
      days INTEGER NOT NULL,
      daily_minutes INTEGER NOT NULL DEFAULT 90,
      capacity INTEGER NOT NULL,
      price_pence INTEGER NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      blurb TEXT NOT NULL,
      instructor TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS course_runs (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      location_id TEXT NOT NULL,
      first_date TEXT NOT NULL,
      daily_hour INTEGER NOT NULL,
      daily_minute INTEGER NOT NULL,
      days INTEGER NOT NULL,
      daily_minutes INTEGER NOT NULL,
      capacity INTEGER NOT NULL,
      price_pence INTEGER NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      blurb TEXT NOT NULL,
      instructor TEXT NOT NULL,
      location TEXT NOT NULL,
      address TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      cancelled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES course_products(id),
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS course_sessions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      day_index INTEGER NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      UNIQUE(run_id, day_index),
      FOREIGN KEY (run_id) REFERENCES course_runs(id)
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'lesson',
      slot_id TEXT,
      course_run_id TEXT,
      status TEXT NOT NULL,
      hold_expires_at TEXT,
      price_pence INTEGER NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      payment_source TEXT,
      return_url TEXT,
      calendar_event_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      rescheduled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (slot_id) REFERENCES slots(id),
      FOREIGN KEY (course_run_id) REFERENCES course_runs(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_slot
      ON bookings(user_id, slot_id)
      WHERE status IN ('pending_payment', 'confirmed') AND slot_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_course
      ON bookings(user_id, course_run_id)
      WHERE status IN ('pending_payment', 'confirmed') AND course_run_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS bookings_slot_status ON bookings(slot_id, status);
    CREATE INDEX IF NOT EXISTS bookings_course_status ON bookings(course_run_id, status);
    CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);

    CREATE TABLE IF NOT EXISTS booking_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      type TEXT NOT NULL,
      from_slot_id TEXT,
      to_slot_id TEXT,
      from_course_run_id TEXT,
      to_course_run_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mock_checkouts (
      session_id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      paid INTEGER NOT NULL DEFAULT 0
    );
  `);

  ensureColumn(db, "slots", "enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "slots", "cancelled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "slots", "location_id", "TEXT");
  ensureColumn(db, "slots", "duration_minutes", "INTEGER");
  ensureColumn(db, "availability_rules", "location_id", "TEXT");
  ensureColumn(db, "bookings", "kind", "TEXT NOT NULL DEFAULT 'lesson'");
  ensureColumn(db, "bookings", "course_run_id", "TEXT");
  ensureColumn(db, "booking_events", "from_course_run_id", "TEXT");
  ensureColumn(db, "booking_events", "to_course_run_id", "TEXT");
  relaxBookingsSlotNull(db);

  try {
    db.exec(`DROP INDEX IF EXISTS bookings_one_active`);
  } catch {
    // Ignore.
  }
}

function relaxBookingsSlotNull(db: DatabaseSync) {
  const cols = getRows<{ name: string; notnull: number }>(db, `PRAGMA table_info(bookings)`);
  const slot = cols.find((col) => col.name === "slot_id");
  if (!slot || slot.notnull === 0) return;
  db.exec(`
    CREATE TABLE bookings_new (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'lesson',
      slot_id TEXT,
      course_run_id TEXT,
      status TEXT NOT NULL,
      hold_expires_at TEXT,
      price_pence INTEGER NOT NULL,
      stripe_session_id TEXT,
      stripe_payment_intent TEXT,
      payment_source TEXT,
      return_url TEXT,
      calendar_event_id TEXT,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      rescheduled_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (slot_id) REFERENCES slots(id),
      FOREIGN KEY (course_run_id) REFERENCES course_runs(id)
    );
    INSERT INTO bookings_new (
      id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
      stripe_session_id, stripe_payment_intent, payment_source, return_url, calendar_event_id,
      created_at, confirmed_at, rescheduled_at
    )
    SELECT
      id, reference, user_id, COALESCE(kind, 'lesson'), slot_id, course_run_id, status, hold_expires_at, price_pence,
      stripe_session_id, stripe_payment_intent, payment_source, return_url, calendar_event_id,
      created_at, confirmed_at, rescheduled_at
    FROM bookings;
    DROP TABLE bookings;
    ALTER TABLE bookings_new RENAME TO bookings;
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_slot
      ON bookings(user_id, slot_id)
      WHERE status IN ('pending_payment', 'confirmed') AND slot_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active_course
      ON bookings(user_id, course_run_id)
      WHERE status IN ('pending_payment', 'confirmed') AND course_run_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS bookings_slot_status ON bookings(slot_id, status);
    CREATE INDEX IF NOT EXISTS bookings_course_status ON bookings(course_run_id, status);
    CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);
  `);
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const rows = getRows<{ name: string }>(db, `PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function getRow<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined;
}

export function getRows<T>(db: DatabaseSync, sql: string, ...params: SQLInputValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The transaction may already have been closed.
    }
    throw error;
  }
}

export function isUniqueError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}
