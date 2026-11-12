import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, test } from "node:test";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { createApp } from "./app.js";
import type { CalendarGateway } from "./calendar.js";
import { createCalendarGateway } from "./calendar.js";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { AppError } from "./errors.js";
import { createMockPayments, type PaymentProvider, type WebhookVerifier } from "./payments.js";
import { RESCHEDULE_CUTOFF_MS, lastBookableDay } from "./rules.js";
import { DEMO_EMAIL, DEMO_PASSWORD, FAREHAM_LOCATION_ID, seedDatabase } from "./seed.js";
import { fromIso, ZONE } from "./time.js";
import type { BookingDto, CourseRunDto, SlotDto } from "./types.js";

const baseConfig: AppConfig = {
  port: 0,
  databasePath: ":memory:",
  jwtSecret: "test-secret-test-secret",
  bcryptRounds: 4,
  apiPublicUrl: "http://127.0.0.1:4000",
  appWebUrl: "http://127.0.0.1:8081",
  paymentsMode: "mock",
  stripeSecretKey: null,
  stripeWebhookSecret: null,
  googleClientId: null,
  googleClientSecret: null,
  adminToken: "test-admin",
  seedDemoUser: false,
  exposeDemoLogin: false,
  nodeEnv: "test",
};

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

async function createTestApp(options?: {
  demo?: boolean;
  exposeDemoLogin?: boolean;
  payments?: PaymentProvider;
  calendar?: CalendarGateway;
  verifyWebhook?: WebhookVerifier;
}) {
  const db = openDatabase(":memory:");
  let now: DateTime = DateTime.fromISO("2026-09-21T12:00:00.000Z");
  const clock = () => now;
  const config: AppConfig = {
    ...baseConfig,
    paymentsMode: options?.payments?.mode ?? "mock",
    seedDemoUser: options?.demo ?? false,
    exposeDemoLogin: options?.exposeDemoLogin ?? false,
  };
  seedDatabase(db, clock, { demo: options?.demo ?? false, bcryptRounds: 4 });
  const payments = options?.payments ?? createMockPayments(db, config);
  const calendar = options?.calendar ?? createCalendarGateway(config);
  const app = createApp({
    db,
    config,
    payments,
    calendar,
    clock,
    verifyWebhook: options?.verifyWebhook,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return {
    db,
    base: `http://127.0.0.1:${address.port}`,
    clock,
    setNow(value: DateTime) {
      now = value;
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      db.close();
    },
  };
}

type ApiResult = { status: number; json: any; text: string; headers: Headers };

async function api(
  base: string,
  path: string,
  options?: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> },
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(options?.headers ?? {}) };
  let body: string | undefined;
  if (options?.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options?.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(`${base}${path}`, { method: options?.method ?? "GET", headers, body, redirect: "manual" });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function register(ctx: Ctx, email = `swimmer-${randomUUID()}@example.com`) {
  const response = await api(ctx.base, "/api/auth/register", {
    method: "POST",
    body: { name: "Test Swimmer", email, password: "harbour-lane" },
  });
  assert.equal(response.status, 201);
  return response.json as { token: string; user: { id: string; email: string; name: string } };
}

function roomy(slots: SlotDto[]): SlotDto {
  const slot = slots.find((item) => item.bookable && !item.soon && item.spotsLeft >= 1);
  if (!slot) throw new Error("expected an open session more than 24 hours away");
  return slot;
}

async function listSlots(
  ctx: Ctx,
  token: string,
  filters?: { locationId?: string; durationMinutes?: number; partySize?: number; excludeBookingId?: string },
): Promise<SlotDto[]> {
  const query = new URLSearchParams();
  if (filters?.locationId) query.set("locationId", filters.locationId);
  if (filters?.durationMinutes !== undefined) query.set("durationMinutes", String(filters.durationMinutes));
  if (filters?.partySize !== undefined) query.set("partySize", String(filters.partySize));
  if (filters?.excludeBookingId) query.set("excludeBookingId", filters.excludeBookingId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await api(ctx.base, `/api/slots${suffix}`, { token });
  assert.equal(response.status, 200);
  return response.json.slots as SlotDto[];
}

async function listCourses(ctx: Ctx, token: string): Promise<CourseRunDto[]> {
  const response = await api(ctx.base, "/api/courses", { token });
  assert.equal(response.status, 200);
  return response.json.courses as CourseRunDto[];
}

async function payForCourse(ctx: Ctx, token: string, courseRunId: string): Promise<BookingDto> {
  const created = await api(ctx.base, "/api/bookings", {
    method: "POST",
    token,
    body: { courseRunId, returnUrl: "http://127.0.0.1:9/payment/success" },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.booking.kind, "course");
  const checkout = new URL(created.json.checkoutUrl as string);
  const payToken = checkout.searchParams.get("token");
  assert.ok(payToken);
  const completed = await api(ctx.base, "/api/payments/mock-complete", {
    method: "POST",
    body: { token: payToken },
  });
  assert.equal(completed.status, 303);
  const returned = await api(ctx.base, completed.headers.get("location") ?? "");
  assert.equal(returned.status, 303);
  const booking = await api(ctx.base, `/api/bookings/${created.json.booking.id}`, { token });
  assert.equal(booking.status, 200);
  assert.equal(booking.json.booking.status, "confirmed");
  return booking.json.booking as BookingDto;
}

async function payFor(ctx: Ctx, token: string, slotId: string): Promise<BookingDto> {
  const created = await api(ctx.base, "/api/bookings", {
    method: "POST",
    token,
    body: { slotId, returnUrl: "http://127.0.0.1:9/payment/success" },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.booking.status, "pending_payment");
  const checkout = new URL(created.json.checkoutUrl as string);
  const payToken = checkout.searchParams.get("token");
  assert.ok(payToken);
  const early = await api(ctx.base, "/api/payments/confirm", {
    method: "POST",
    token,
    body: { sessionId: created.json.sessionId },
  });
  assert.equal(early.status, 402);
  assert.equal(early.json.error.code, "PAYMENT_REQUIRED");
  const completed = await api(ctx.base, "/api/payments/mock-complete", {
    method: "POST",
    body: { token: payToken },
  });
  assert.equal(completed.status, 303);
  const returned = await api(ctx.base, completed.headers.get("location") ?? "");
  assert.equal(returned.status, 303);
  assert.match(returned.headers.get("location") ?? "", /127\.0\.0\.1:9\/payment\/success/);
  const booking = await api(ctx.base, `/api/bookings/${created.json.booking.id}`, { token });
  assert.equal(booking.status, 200);
  assert.equal(booking.json.booking.status, "confirmed");
  assert.equal(booking.json.booking.paymentSource, "mock");
  return booking.json.booking as BookingDto;
}

describe("lido api", { concurrency: 1 }, () => {
  test("requires sign-in, rejects a short password, and hides the password hash", async () => {
    const ctx = await createTestApp();
    try {
      const slots = await api(ctx.base, "/api/slots");
      assert.equal(slots.status, 401);
      const weak = await api(ctx.base, "/api/auth/register", {
        method: "POST",
        body: { name: "A", email: "a@example.com", password: "short" },
      });
      assert.equal(weak.status, 400);
      assert.equal(weak.json.error.code, "VALIDATION");
      const account = await register(ctx);
      assert.equal(account.user.email.includes("@"), true);
      assert.equal("password" in account.user, false);
      const me = await api(ctx.base, "/api/me", { token: account.token });
      assert.equal(me.json.user.email, account.user.email);
      const wrong = await api(ctx.base, "/api/auth/login", {
        method: "POST",
        body: { email: account.user.email, password: "not-the-password" },
      });
      assert.equal(wrong.status, 401);
    } finally {
      await ctx.close();
    }
  });

  test("lists only the next six weeks, including a full session, and rejects anything later", async () => {
    const ctx = await createTestApp();
    try {
      const { token } = await register(ctx);
      const slots = await listSlots(ctx, token);
      const last = lastBookableDay(ctx.clock()).setZone(ZONE).toFormat("yyyy-MM-dd");
      assert.ok(slots.some((slot) => slot.dateKey === last));
      assert.ok(slots.every((slot) => slot.dateKey <= last));
      assert.ok(slots.some((slot) => slot.spotsLeft === 0 && slot.bookable === false));
      const rows = ctx.db.prepare(`SELECT id, starts_at FROM slots`).all() as { id: string; starts_at: string }[];
      const far = rows.find((row) => fromIso(row.starts_at).setZone(ZONE).startOf("day") > lastBookableDay(ctx.clock()));
      assert.ok(far);
      assert.equal(slots.some((slot) => slot.id === far.id), false);
      const detail = await api(ctx.base, `/api/slots/${far.id}`, { token });
      assert.equal(detail.json.slot.bookable, false);
      const booked = await api(ctx.base, "/api/bookings", {
        method: "POST",
        token,
        body: { slotId: far.id, returnUrl: "http://127.0.0.1:9/payment/success" },
      });
      assert.equal(booked.status, 400);
      assert.equal(booked.json.error.code, "TOO_FAR_AHEAD");
      const before = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM slots`).get() as { n: number }).n;
      seedDatabase(ctx.db, ctx.clock, { demo: false, bcryptRounds: 4 });
      const after = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM slots`).get() as { n: number }).n;
      assert.equal(before, after);
    } finally {
      await ctx.close();
    }
  });

  test("confirms a booking only after payment, holds capacity, and frees it when the hold expires", async () => {
    const ctx = await createTestApp();
    try {
      const first = await register(ctx);
      const second = await register(ctx);
      const created = await api(ctx.base, "/api/admin/slots", {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: {
          startsAt: ctx.clock().plus({ days: 3 }).toUTC().toISO(),
          locationId: FAREHAM_LOCATION_ID,
          durationMinutes: 30,
          capacity: 1,
          pricePence: 2200,
          title: "Admin lesson",
          instructor: "Helen Ward",
          blurb: "A single-spot session used to prove the capacity rule.",
        },
      });
      assert.equal(created.status, 201, created.text);
      const slotId = created.json.slot.id as string;
      const held = await api(ctx.base, "/api/bookings", {
        method: "POST",
        token: first.token,
        body: { slotId, returnUrl: "http://127.0.0.1:9/payment/success" },
      });
      assert.equal(held.status, 201);
      const blocked = await api(ctx.base, "/api/bookings", {
        method: "POST",
        token: second.token,
        body: { slotId, returnUrl: "http://127.0.0.1:9/payment/success" },
      });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.json.error.code, "SLOT_FULL");
      ctx.setNow(ctx.clock().plus({ minutes: 46 }));
      const booking = await payFor(ctx, second.token, slotId);
      assert.equal(booking.slot!.id, slotId);
      const late = await api(ctx.base, "/api/payments/mock-complete", {
        method: "POST",
        body: { token: new URL(held.json.checkoutUrl).searchParams.get("token") },
      });
      assert.equal(late.status, 303);
      const returned = await api(ctx.base, late.headers.get("location") ?? "");
      assert.equal(returned.status, 409);
      assert.match(returned.text, /filled after the hold expired/);
      const firstBooking = await api(ctx.base, `/api/bookings/${held.json.booking.id}`, { token: first.token });
      assert.notEqual(firstBooking.json.booking.status, "confirmed");
      const stranger = await api(ctx.base, `/api/bookings/${booking.id}`, { token: first.token });
      assert.equal(stranger.status, 404);
    } finally {
      await ctx.close();
    }
  });

  test("rearranges a paid lesson outside 24 hours and blocks one inside the window", async () => {
    const ctx = await createTestApp();
    try {
      const { token } = await register(ctx);
      const slots = await listSlots(ctx, token);
      const soon = slots.find((slot) => slot.soon && slot.bookable);
      const later = roomy(slots);
      assert.ok(soon);
      const soonBooking = await payFor(ctx, token, soon.id);
      assert.equal(soonBooking.rescheduleAllowed, false);
      assert.match(soonBooking.rescheduleBlockedReason ?? "", /24 hours/);
      const blocked = await api(ctx.base, `/api/bookings/${soonBooking.id}/reschedule`, {
        method: "POST",
        token,
        body: { slotId: later.id },
      });
      assert.equal(blocked.status, 409);
      assert.equal(blocked.json.error.code, "RESCHEDULE_WINDOW_CLOSED");

      const open = await payFor(ctx, token, later.id);
      assert.equal(open.rescheduleAllowed, true);
      const heldAside = await listSlots(ctx, token, { excludeBookingId: open.id });
      assert.equal(heldAside.find((slot) => slot.id === later.id)?.bookable, true);
      const target = slots.find(
        (slot) => slot.bookable && !slot.soon && slot.id !== later.id && slot.startsAt >= later.endsAt,
      );
      assert.ok(target);
      const other = await register(ctx);
      const before = await listSlots(ctx, other.token);
      const moved = await api(ctx.base, `/api/bookings/${open.id}/reschedule`, {
        method: "POST",
        token,
        body: { slotId: target.id },
      });
      assert.equal(moved.status, 200, moved.text);
      assert.equal(moved.json.booking.slot!.id, target.id);
      assert.match(moved.json.booking.googleCalendarUrl, /calendar\.google\.com/);
      const after = await listSlots(ctx, other.token);
      const oldBefore = before.find((slot) => slot.id === later.id)!;
      const oldAfter = after.find((slot) => slot.id === later.id)!;
      const newAfter = after.find((slot) => slot.id === target.id)!;
      assert.equal(oldBefore.bookable, false);
      assert.equal(oldAfter.bookable, true);
      assert.equal(newAfter.bookable, false);

      const exactStart = ctx.clock().plus({ milliseconds: RESCHEDULE_CUTOFF_MS }).toUTC().toISO()!;
      const exact = await api(ctx.base, "/api/admin/slots", {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: {
          startsAt: exactStart,
          locationId: FAREHAM_LOCATION_ID,
          durationMinutes: 30,
          capacity: 1,
          pricePence: 2200,
          title: "Boundary lesson",
          instructor: "Helen Ward",
          blurb: "Starts exactly 24 hours from the test clock.",
        },
      });
      const exactBooking = await payFor(ctx, token, exact.json.slot.id);
      const exactMove = await api(ctx.base, `/api/bookings/${exactBooking.id}/reschedule`, {
        method: "POST",
        token,
        body: { slotId: later.id },
      });
      assert.equal(exactMove.status, 200, exactMove.text);

      const insideStart = ctx.clock().plus({ milliseconds: RESCHEDULE_CUTOFF_MS - 1 }).toUTC().toISO()!;
      const inside = await api(ctx.base, "/api/admin/slots", {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: {
          startsAt: insideStart,
          locationId: FAREHAM_LOCATION_ID,
          durationMinutes: 30,
          capacity: 1,
          pricePence: 2200,
          title: "Inside lesson",
          instructor: "Helen Ward",
          blurb: "Starts just inside the 24 hour window.",
        },
      });
      const insideBooking = await payFor(ctx, token, inside.json.slot.id);
      const insideMove = await api(ctx.base, `/api/bookings/${insideBooking.id}/reschedule`, {
        method: "POST",
        token,
        body: { slotId: target.id },
      });
      assert.equal(insideMove.status, 409);
      assert.equal(insideMove.json.error.code, "RESCHEDULE_WINDOW_CLOSED");
    } finally {
      await ctx.close();
    }
  });

  test("seeds a demo lesson that can be rearranged and does not require Stripe", async () => {
    const ctx = await createTestApp({ demo: true, exposeDemoLogin: true });
    try {
      const config = await api(ctx.base, "/api/config");
      assert.equal(config.json.demoLogin.email, DEMO_EMAIL);
      assert.equal(config.json.paymentsMode, "mock");
      const login = await api(ctx.base, "/api/auth/login", {
        method: "POST",
        body: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });
      assert.equal(login.status, 200);
      const bookings = await api(ctx.base, "/api/bookings", { token: login.json.token });
      assert.equal(bookings.json.bookings.length, 1);
      assert.equal(bookings.json.bookings[0].paymentSource, "seed");
      assert.equal(bookings.json.bookings[0].rescheduleAllowed, true);
      const slots = await listSlots(ctx, login.json.token);
      const target = roomy(slots.filter((slot) => slot.id !== bookings.json.bookings[0].slot!.id));
      const moved = await api(ctx.base, `/api/bookings/${bookings.json.bookings[0].id}/reschedule`, {
        method: "POST",
        token: login.json.token,
        body: { slotId: target.id },
      });
      assert.equal(moved.status, 200, moved.text);
    } finally {
      await ctx.close();
    }
  });

  test("a Stripe webhook confirms a paid session and ignores an unpaid one", async () => {
    const paid = new Set<string>();
    const sessions = new Map<string, string>();
    const payments: PaymentProvider = {
      mode: "stripe",
      async createCheckout(input) {
        const id = `cs_${input.bookingId}`;
        sessions.set(id, input.bookingId);
        return { id, url: `https://checkout.stripe.test/${id}` };
      },
      async verifyPaid(sessionId) {
        return {
          paid: paid.has(sessionId),
          bookingId: sessions.get(sessionId) ?? null,
          paymentIntentId: paid.has(sessionId) ? "pi_test" : null,
        };
      },
    };
    let webhook: { type: string; sessionId: string | null } = { type: "checkout.session.completed", sessionId: null };
    const verifyWebhook: WebhookVerifier = () => webhook;
    const ctx = await createTestApp({ payments, verifyWebhook });
    try {
      const { token } = await register(ctx);
      const slot = roomy(await listSlots(ctx, token));
      const created = await api(ctx.base, "/api/bookings", {
        method: "POST",
        token,
        body: { slotId: slot.id, returnUrl: "lido://payment/success" },
      });
      assert.equal(created.status, 201);
      assert.match(created.json.checkoutUrl, /checkout\.stripe\.test/);
      webhook = { type: "checkout.session.completed", sessionId: created.json.sessionId };
      const unpaid = await api(ctx.base, "/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1" },
        body: { id: "evt_1" },
      });
      assert.equal(unpaid.status, 402);
      paid.add(created.json.sessionId);
      const paidEvent = await api(ctx.base, "/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": "t=1" },
        body: { id: "evt_2" },
      });
      assert.equal(paidEvent.status, 200);
      const booking = await api(ctx.base, `/api/bookings/${created.json.booking.id}`, { token });
      assert.equal(booking.json.booking.status, "confirmed");
      assert.equal(booking.json.booking.paymentSource, "stripe");
      const mockPage = await api(ctx.base, "/api/payments/mock-checkout?token=nope");
      assert.equal(mockPage.status, 404);
    } finally {
      await ctx.close();
    }
  });

  test("connects Google Calendar and syncs the event when a booking is paid or moved", async () => {
    const events: { eventId?: string | null; summary: string }[] = [];
    const calendar: CalendarGateway = {
      configured: true,
      authUrl(state) {
        return `https://accounts.google.test/o/oauth2/auth?state=${encodeURIComponent(state)}`;
      },
      async exchangeCode(code) {
        if (code !== "good-code") throw new AppError(400, "CALENDAR_AUTH", "bad code");
        return { refreshToken: "refresh-token", email: "lane@gmail.test" };
      },
      async upsertEvent(input) {
        events.push({ eventId: input.eventId, summary: input.summary });
        return { eventId: input.eventId ?? "evt_1", htmlLink: "https://calendar.google.test/evt_1" };
      },
    };
    const ctx = await createTestApp({ calendar });
    try {
      const { token } = await register(ctx);
      const unconfigured = await createTestApp();
      try {
        const other = await register(unconfigured);
        const missing = await api(unconfigured.base, "/api/calendar/connect", {
          method: "POST",
          token: other.token,
          body: { returnUrl: "http://127.0.0.1:9/account" },
        });
        assert.equal(missing.status, 503);
        assert.equal(missing.json.error.code, "CALENDAR_NOT_CONFIGURED");
      } finally {
        await unconfigured.close();
      }

      const connect = await api(ctx.base, "/api/calendar/connect", {
        method: "POST",
        token,
        body: { returnUrl: "http://127.0.0.1:9/account" },
      });
      assert.equal(connect.status, 200);
      const state = new URL(connect.json.url).searchParams.get("state");
      assert.ok(state);
      const callback = await api(ctx.base, `/api/calendar/callback?code=good-code&state=${encodeURIComponent(state)}`);
      assert.equal(callback.status, 303);
      assert.match(callback.headers.get("location") ?? "", /calendar=connected/);
      const status = await api(ctx.base, "/api/calendar/status", { token });
      assert.equal(status.json.connected, true);
      assert.equal(status.json.email, "lane@gmail.test");
      assert.equal(status.json.refreshToken, undefined);

      const slots = await listSlots(ctx, token);
      const first = roomy(slots);
      const second = slots.find((slot) => slot.bookable && !slot.soon && slot.id !== first.id && slot.spotsLeft >= 1);
      assert.ok(second);
      const booking = await payFor(ctx, token, first.id);
      assert.equal(booking.calendarSynced, true);
      assert.equal(events.length, 1);
      assert.match(events[0]!.summary, new RegExp(first.title));
      const moved = await api(ctx.base, `/api/bookings/${booking.id}/reschedule`, {
        method: "POST",
        token,
        body: { slotId: second.id },
      });
      assert.equal(moved.status, 200, moved.text);
      assert.equal(events.length, 2);
      assert.equal(events[1]!.eventId, "evt_1");
      const disconnected = await api(ctx.base, "/api/calendar", { method: "DELETE", token });
      assert.equal(disconnected.json.connected, false);
    } finally {
      await ctx.close();
    }
  });

  test("admin weekly rules feed the customer calendar and cancelled sessions stay hidden", async () => {
    const ctx = await createTestApp();
    try {
      const { token } = await register(ctx);
      const listed = await api(ctx.base, "/api/slots", { token });
      assert.equal(listed.status, 200);
      assert.ok(listed.json.days.length > 0);
      assert.ok(listed.json.days.every((day: { selectable: boolean; openCount: number }) => !day.selectable || day.openCount > 0));
      assert.ok(listed.json.slots.every((slot: SlotDto) => slot.bookable || slot.spotsLeft === 0));

      const created = await api(ctx.base, "/api/admin/windows", {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: {
          locationId: FAREHAM_LOCATION_ID,
          weekday: 5,
          startHour: 11,
          startMinute: 0,
          endHour: 13,
          endMinute: 0,
        },
      });
      assert.equal(created.status, 201, created.text);
      assert.equal(created.json.window.weekday, 5);

      const tooBig = await api(ctx.base, "/api/admin/rules", {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: {
          locationId: FAREHAM_LOCATION_ID,
          weekday: 5,
          hour: 12,
          minute: 0,
          durationMinutes: 30,
          capacity: 8,
          pricePence: 2200,
          title: "Too many swimmers",
          instructor: "Helen Ward",
          blurb: "A class-size session that this school does not offer.",
        },
      });
      assert.equal(tooBig.status, 400);

      const after = await listSlots(ctx, token, { durationMinutes: 60, partySize: 1 });
      const friday = after.filter((slot) => slot.dayLabel.startsWith("Friday") && slot.startTimeLabel === "11:00am");
      assert.ok(friday.length > 0);
      assert.ok(friday.every((slot) => slot.bookable));
      assert.equal(friday[0]!.pricePence, 6000);

      const disabled = await api(ctx.base, `/api/admin/windows/${created.json.window.id}/enabled`, {
        method: "POST",
        headers: { "x-admin-token": "test-admin" },
        body: { enabled: false },
      });
      assert.equal(disabled.status, 200);
      const withoutFriday = await listSlots(ctx, token, { durationMinutes: 60, partySize: 1 });
      assert.equal(withoutFriday.some((slot) => slot.startTimeLabel === "11:00am" && slot.dayLabel.startsWith("Friday")), false);

      const form = await fetch(`${ctx.base}/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "token=test-admin",
        redirect: "manual",
      });
      assert.equal(form.status, 303);
      assert.match(form.headers.get("set-cookie") ?? "", /lido_admin=/);
    } finally {
      await ctx.close();
    }
  });

  test("lists Fareham locations and filters single lessons by duration", async () => {
    const ctx = await createTestApp();
    try {
      const { token } = await register(ctx);
      const locations = await api(ctx.base, "/api/locations", { token });
      assert.equal(locations.status, 200);
      assert.ok(locations.json.locations.some((location: { name: string }) => location.name.includes("Fareham")));

      const thirty = await listSlots(ctx, token, { durationMinutes: 30 });
      const sixty = await listSlots(ctx, token, { durationMinutes: 60 });
      assert.ok(thirty.every((slot) => slot.durationMinutes === 30));
      assert.ok(sixty.every((slot) => slot.durationMinutes === 60));
      assert.ok(thirty.length > 0);
      assert.ok(sixty.length > 0);
      assert.equal(thirty.some((slot) => sixty.some((other) => other.id === slot.id)), false);
      assert.ok(thirty.every((slot) => slot.capacity === 1 || slot.capacity === 2));
      assert.equal("level" in thirty[0]!, false);

      const solo = await listSlots(ctx, token, { partySize: 1 });
      const pair = await listSlots(ctx, token, { partySize: 2 });
      assert.ok(solo.length > 0);
      assert.ok(pair.length > 0);
      assert.ok(solo.every((slot) => slot.capacity === 1 && slot.partyLabel === "1-to-1"));
      assert.ok(pair.every((slot) => slot.capacity === 2 && slot.partyLabel === "1-to-2"));

      const config = await api(ctx.base, "/api/config");
      assert.deepEqual(config.json.lessonDurations, [30, 60]);
      assert.deepEqual(config.json.courseLengths, [3, 4, 5]);
    } finally {
      await ctx.close();
    }
  });

  test("suggests the next crash course and moves one day until 24 hours before it", async () => {
    const ctx = await createTestApp();
    try {
      const { token } = await register(ctx);
      const plan = await api(ctx.base, "/api/course-plans?days=3", { token });
      assert.equal(plan.status, 200);
      assert.equal(plan.json.pricePence, 34900);
      assert.match(plan.json.priceLabel, /349/);
      const suggestion = plan.json.suggestions[0];
      assert.ok(suggestion);
      assert.equal(suggestion.sessions.length, 3);
      assert.deepEqual(
        suggestion.sessions.map((session: { dateKey: string }) => session.dateKey),
        ["2026-09-22", "2026-09-23", "2026-09-24"],
      );
      assert.ok(suggestion.sessions.every((session: { hour: number; minute: number }) => session.hour === 6 && session.minute === 0));
      const four = await api(ctx.base, "/api/course-plans?days=4", { token });
      const five = await api(ctx.base, "/api/course-plans?days=5", { token });
      assert.equal(four.json.pricePence, 44900);
      assert.equal(five.json.pricePence, 54900);

      const custom = [
        suggestion.sessions[0],
        suggestion.sessions[2],
        { dateKey: "2026-09-26", hour: 6, minute: 0 },
      ];
      const held = await api(ctx.base, "/api/basket/course", {
        method: "POST",
        token,
        body: { days: 3, sessions: custom.map((session) => ({ dateKey: session.dateKey, hour: session.hour, minute: session.minute })) },
      });
      assert.equal(held.status, 201, held.text);
      assert.equal(held.json.items.length, 1);
      assert.equal(held.json.items[0].kind, "course");
      assert.equal(held.json.items[0].pricePence, 34900);
      assert.deepEqual(
        held.json.items[0].course.sessions.map((session: { dateKey: string }) => session.dateKey),
        ["2026-09-22", "2026-09-24", "2026-09-26"],
      );

      const duplicate = await api(ctx.base, "/api/basket/course", {
        method: "POST",
        token: (await register(ctx)).token,
        body: { days: 3, sessions: custom.map((session) => ({ dateKey: session.dateKey, hour: session.hour, minute: session.minute })) },
      });
      assert.equal(duplicate.status, 409);

      const checkout = await api(ctx.base, "/api/basket/checkout", {
        method: "POST",
        token,
        body: { returnUrl: "http://127.0.0.1:9/payment/success" },
      });
      assert.equal(checkout.status, 200, checkout.text);
      const payToken = new URL(checkout.json.checkoutUrl as string).searchParams.get("token");
      assert.ok(payToken);
      const completed = await api(ctx.base, "/api/payments/mock-complete", { method: "POST", body: { token: payToken } });
      assert.equal(completed.status, 303);
      const returned = await api(ctx.base, completed.headers.get("location") ?? "");
      assert.equal(returned.status, 303);
      const confirmed = await api(ctx.base, `/api/bookings/${held.json.items[0].id}`, { token });
      assert.equal(confirmed.status, 200);
      const paid = confirmed.json.booking;
      assert.equal(paid.pricePence, 34900);
      const [locked, open] = paid.course!.sessions;
      assert.equal(locked!.movable, false);
      assert.match(locked!.moveBlockedReason ?? "", /24 hours/);
      assert.equal(open!.movable, true);
      const blockedMove = await api(ctx.base, `/api/bookings/${paid.id}/sessions/${locked!.id}/reschedule`, {
        method: "POST",
        token,
        body: { dateKey: "2026-09-28", hour: 6, minute: 0 },
      });
      assert.equal(blockedMove.status, 409);
      const moved = await api(ctx.base, `/api/bookings/${paid.id}/sessions/${open!.id}/reschedule`, {
        method: "POST",
        token,
        body: { dateKey: "2026-09-28", hour: 6, minute: 0 },
      });
      assert.equal(moved.status, 200, moved.text);
      assert.ok(moved.json.booking.course.sessions.some((session: { dateKey: string }) => session.dateKey === "2026-09-28"));
      assert.equal(moved.json.booking.course.sessions.some((session: { dateKey: string }) => session.dateKey === open!.dateKey), false);

      const location = await api(ctx.base, "/api/locations", { token });
      const fareham = location.json.locations.find((item: { name: string }) => item.name.includes("Fareham"));
      assert.match(fareham.address, /PO16 0DZ/);
      assert.match(fareham.arrivalInstructions, /pop your shoes off/);
    } finally {
      await ctx.close();
    }
  });
});
