import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { googleCalendarTemplateUrl, presentLocation, presentSlot } from "./format.js";
import type { LocationRow, SlotRow } from "./types.js";

test("formats London labels, week buckets, and a Google Calendar template", () => {
  const starts = DateTime.fromISO("2026-09-23T18:00:00.000Z");
  const ends = starts.plus({ minutes: 30 });
  const now = DateTime.fromISO("2026-09-21T12:00:00.000Z");
  const row: SlotRow = {
    id: "slot_1",
    rule_id: "weekly-wed",
    location_id: "loc_fareham",
    starts_at: starts.toUTC().toISO()!,
    ends_at: ends.toUTC().toISO()!,
    duration_minutes: 30,
    capacity: 8,
    price_pence: 2200,
    title: "Adult beginners",
    level: "Beginners",
    blurb: "A first stroke.",
    location: "West Street Fareham",
    address: "153 West Street, Fareham PO16 0EL",
    instructor: "Sam Okonkwo",
    enabled: 1,
    cancelled: 0,
  };
  const slot = presentSlot(row, 1, now);
  assert.equal(slot.locationId, "loc_fareham");
  assert.equal(slot.durationMinutes, 30);
  assert.equal(slot.dayLabel, "Wednesday 23 September");
  assert.equal(slot.timeLabel, "7:00pm–7:30pm");
  assert.equal(slot.dateKey, "2026-09-23");
  assert.equal(slot.weekKey, "2026-09-21");
  assert.equal(slot.weekLabel, "21–27 Sep");
  assert.equal(slot.spotsLeft, 7);
  assert.equal(slot.spotsLabel, "7 spots left");
  assert.match(slot.priceLabel, /22\.00/);

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
  assert.match(link, /20260923T183000Z/);
  assert.match(link, /LD-TEST01/);
});

test("presents a location row", () => {
  const row: LocationRow = {
    id: "loc_fareham",
    name: "West Street Fareham",
    address: "153 West Street, Fareham PO16 0EL",
    enabled: 1,
    created_at: "2026-09-21T12:00:00.000Z",
    updated_at: "2026-09-21T12:00:00.000Z",
  };
  const location = presentLocation(row);
  assert.equal(location.id, "loc_fareham");
  assert.equal(location.name, "West Street Fareham");
  assert.equal(location.enabled, true);
});
