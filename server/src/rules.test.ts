import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DateTime } from "luxon";
import { getBookingBlock, getRescheduleBlock, lastBookableDay, RESCHEDULE_CUTOFF_MS, spotsRemaining } from "./rules.js";
import { ZONE } from "./time.js";

const now = DateTime.fromISO("2026-09-21T12:00:00.000Z");

describe("booking window", () => {
  test("allows the calendar day six weeks ahead in Europe/London and blocks the next day", () => {
    const last = lastBookableDay(now);
    const lastEvening = last.set({ hour: 19, minute: 0 });
    const nextMorning = last.plus({ days: 1 }).set({ hour: 9, minute: 0 });
    assert.equal(getBookingBlock(lastEvening, now).ok, true);
    const blocked = getBookingBlock(nextMorning, now);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "TOO_FAR_AHEAD");
  });

  test("blocks a session that has already started", () => {
    const blocked = getBookingBlock(now.minus({ minutes: 1 }), now);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "SLOT_IN_PAST");
  });
});

describe("reschedule cutoff", () => {
  test("allows a change at exactly 24 hours and blocks one millisecond later", () => {
    const start = now.plus({ milliseconds: RESCHEDULE_CUTOFF_MS });
    assert.equal(getRescheduleBlock(start, now).ok, true);
    const inside = getRescheduleBlock(start.minus({ milliseconds: 1 }), now);
    assert.equal(inside.ok, false);
    if (!inside.ok) assert.equal(inside.code, "RESCHEDULE_WINDOW_CLOSED");
  });

  test("uses elapsed hours across the October clock change", () => {
    const start = DateTime.fromISO("2026-10-25T19:00:00", { zone: ZONE });
    const closesAt = DateTime.fromMillis(start.toMillis() - RESCHEDULE_CUTOFF_MS, { zone: "utc" });
    assert.equal(getRescheduleBlock(start, closesAt).ok, true);
    assert.equal(getRescheduleBlock(start, closesAt.plus({ milliseconds: 1 })).ok, false);
  });

  test("says the session has started once the start time has passed", () => {
    const started = getRescheduleBlock(now.minus({ minutes: 5 }), now);
    assert.equal(started.ok, false);
    if (!started.ok) assert.match(started.message, /already started/);
  });
});

describe("capacity", () => {
  test("counts a free spot only when occupied is below capacity", () => {
    assert.equal(spotsRemaining(8, 7), 1);
    assert.equal(spotsRemaining(1, 1), 0);
    assert.equal(spotsRemaining(1, 3), 0);
  });
});
