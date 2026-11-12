import assert from "node:assert/strict";
import { test } from "node:test";
import { DateTime } from "luxon";
import { coursePaymentPlan } from "./deposits.js";

const bookedAt = DateTime.fromISO("2026-09-21T12:00:00.000Z");

test("takes a 20 percent deposit when the course starts more than four weeks ahead", () => {
  const first = DateTime.fromISO("2027-02-02T06:00:00", { zone: "Europe/London" });
  const plan = coursePaymentPlan(34900, first, bookedAt);
  assert.equal(plan.depositPence, 6980);
  assert.equal(plan.balancePence, 27920);
  assert.equal(plan.payTodayPence, 6980);
  assert.equal(plan.fullUpfront, false);
  assert.equal(plan.dueAt?.setZone("Europe/London").toISODate(), "2027-01-05");
  assert.equal(coursePaymentPlan(44900, first, bookedAt).depositPence, 8980);
  assert.equal(coursePaymentPlan(54900, first, bookedAt).depositPence, 10980);
});

test("takes the full fee when the first day is inside four weeks", () => {
  const first = DateTime.fromISO("2026-09-22T06:00:00", { zone: "Europe/London" });
  const plan = coursePaymentPlan(34900, first, bookedAt);
  assert.equal(plan.fullUpfront, true);
  assert.equal(plan.payTodayPence, 34900);
  assert.equal(plan.balancePence, 0);
});
