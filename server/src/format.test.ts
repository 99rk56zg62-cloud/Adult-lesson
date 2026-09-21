import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { googleCalendarTemplateUrl, presentSlot } from "./format.js";
import type { SlotRow } from "./types.js";

test("formats London labels, week buckets, and a Google Calendar template", () => {
  const starts = DateTime.fromISO("2026-09-23T18:00:00.000Z");
  const ends = starts.plus({ minutes: 45 });
  const now = DateTime.fromISO("2026-09-21T12:00:00.000Z");
  const row: SlotRow = {
    id: "slot_1",
    rule_id: "weekly-wed",
    starts_at: starts.toUTC().toISO()!,
    ends_at: ends.toUTC().toISO()!,
    capacity: 8,
    price_pence: 2800,
    title: "Adult beginners",
    level: "Beginners",
    blurb: "A first stroke.",
    location: "Riverside Lido",
    address: "Pool Lane, Bristol",
    instructor: "Sam Okonkwo",
  };
  const slot = presentSlot(row, 1, now);
  assert.equal(slot.dayLabel, "Wednesday 23 September");
  assert.equal(slot.timeLabel, "7:00pm–7:45pm");
  assert.equal(slot.dateKey, "2026-09-23");
  assert.equal(slot.weekKey, "2026-09-21");
  assert.equal(slot.weekLabel, "21–27 Sep");
  assert.equal(slot.spotsLeft, 7);
  assert.equal(slot.spotsLabel, "7 spots left");
  assert.match(slot.priceLabel, /28\.00/);

  const link = googleCalendarTemplateUrl({
    title: row.title,
    startsAt: starts,
    endsAt: ends,
    location: row.location,
    address: row.address,
    reference: "LD-TEST01",
    level: row.level,
  });
  assert.match(link, /calendar\.google\.com/);
  assert.match(link, /20260923T180000Z/);
  assert.match(link, /20260923T184500Z/);
  assert.match(link, /LD-TEST01/);
});
