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

    CREATE TABLE IF NOT EXISTS slots (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      capacity INTEGER NOT NULL,
      price_pence INTEGER NOT NULL,
      title TEXT NOT NULL,
      level TEXT NOT NULL,
      blurb TEXT NOT NULL,
      location TEXT NOT NULL,
      address TEXT NOT NULL,
      instructor TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS slots_rule_start ON slots(rule_id, starts_at);

    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      reference TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      slot_id TEXT NOT NULL,
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
      FOREIGN KEY (slot_id) REFERENCES slots(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_active
      ON bookings(user_id, slot_id)
      WHERE status IN ('pending_payment', 'confirmed');

    CREATE INDEX IF NOT EXISTS bookings_slot_status ON bookings(slot_id, status);
    CREATE INDEX IF NOT EXISTS bookings_user ON bookings(user_id);

    CREATE TABLE IF NOT EXISTS booking_events (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      type TEXT NOT NULL,
      from_slot_id TEXT,
      to_slot_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mock_checkouts (
      session_id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      paid INTEGER NOT NULL DEFAULT 0
    );
  `);
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
