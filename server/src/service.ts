import { randomBytes, randomUUID } from "node:crypto";
import { BUSINESS_NAME } from "../../mobile/src/brand.js";
import {
  assertStoredSlotOpen,
  lessonPricePence,
  listLessonRates,
  listWindowOffers,
  listWindows,
  materializeOffer,
  parseOfferId,
  setLessonRate,
  upsertWindow,
  type WindowRow,
} from "./offers.js";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import {
  COURSE_DAILY_MINUTES,
  COURSE_LENGTHS,
  COURSE_PACKAGE_PRICES,
  COURSE_MORNING_END_HOUR,
  COURSE_MORNING_START_HOUR,
  LESSON_DURATIONS,
  assertCourseDays,
  assertLessonDuration,
  assertMorningWindow,
  disableFutureRuleSlots,
  materializeCourseRun,
  materializeEnabledRules,
  materializeRule,
  upsertRule,
  type RuleInput,
} from "./availability.js";
import { hashPassword, readOAuthState, signAccessToken, signOAuthState, verifyPassword } from "./auth.js";
import type { CalendarGateway } from "./calendar.js";
import { assertCourseSessions, assertSessionOpen, listCourseDayOptions, suggestCrashCourses, type SessionChoice } from "./course-plans.js";
import { contactQuestion, loadCustomerPages, presentCustomerPages, saveCustomerPages, type CustomerPages } from "./guides.js";
import type { CourseLength } from "./availability.js";
import { BALANCE_REMINDER_DAYS, coursePaymentPlan } from "./deposits.js";
import { assertProfileInput, type ProfileInput } from "./profile.js";
import type { AppConfig } from "./config.js";
import { getRow, getRows, isUniqueError, withTransaction } from "./db.js";
import { AppError } from "./errors.js";
import {
  presentBooking,
  presentCourseProduct,
  presentCourseRun,
  presentLocation,
  presentRule,
  presentSlot,
  formatDeadline,
  formatGBP,
} from "./format.js";
import type { PaymentProvider } from "./payments.js";
import { isAllowedReturnUrl } from "./return-url.js";
import { getBookingBlock, getRescheduleBlock, HOLD_MS, lastBookableDay, MAX_ADVANCE_WEEKS } from "./rules.js";
import { DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD, FAREHAM_LOCATION_ID } from "./seed.js";
import { fromIso, parseInstant, toUtcIso, ZONE } from "./time.js";
import type {
  AvailabilityRuleDto,
  AvailabilityRuleRow,
  BookingDto,
  BookingRow,
  CourseProductDto,
  CourseProductRow,
  CourseRunDto,
  CourseRunRow,
  CourseSessionRow,
  DayAvailability,
  LocationDto,
  LocationRow,
  PublicConfig,
  SlotDto,
  SlotRow,
  UserDto,
  UserRow,
} from "./types.js";

export type ServiceDeps = {
  db: DatabaseSync;
  clock: () => DateTime;
  config: AppConfig;
  payments: PaymentProvider;
  calendar: CalendarGateway;
};

export type CheckoutResult = {
  booking: BookingDto;
  checkoutUrl: string;
  sessionId: string;
  paidImmediately?: boolean;
};

export type MutationResult = {
  booking: BookingDto;
  calendarSyncError: string | null;
  returnUrl: string | null;
};

const CALENDAR_SYNC_WARNING =
  "The booking is confirmed, but Google Calendar couldn't be updated. Try syncing again from the booking.";

const SLOT_TAKEN_MESSAGE =
  "Payment was received, but the session filled after the hold expired, so the booking was not confirmed. If you paid by card, refund the payment in the Stripe dashboard and book another session.";

const COURSE_TAKEN_MESSAGE =
  "Payment was received, but the course filled after the hold expired, so the booking was not confirmed. If you paid by card, refund the payment in the Stripe dashboard and book another course.";

type CardRow = {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: number;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  town: string | null;
  postcode: string | null;
  date_of_birth: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_relationship: string | null;
  emergency_phone: string | null;
  medical_none: number | null;
  medical_notes: string | null;
  swimming_level: string | null;
};

export function createService(deps: ServiceDeps) {
  const { db, clock, config, payments, calendar } = deps;

  function nowIso() {
    return toUtcIso(clock());
  }

  function expireStale() {
    db.prepare(
      `UPDATE bookings SET status = 'expired'
       WHERE status = 'pending_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at <= ?`,
    ).run(nowIso());
  }

  async function rememberCard(userId: string, customerId: string, paymentMethodId: string) {
    const existing = getRow<{ id: string }>(
      db,
      `SELECT id FROM payment_cards WHERE user_id = ? AND stripe_payment_method_id = ?`,
      userId,
      paymentMethodId,
    );
    if (existing) return;
    const details = await payments.describeCard(paymentMethodId);
    if (!details || !/^\d{4}$/.test(details.last4)) return;
    const count = getRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM payment_cards WHERE user_id = ?`, userId);
    db.prepare(
      `INSERT INTO payment_cards (
        id, user_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      userId,
      customerId,
      paymentMethodId,
      details.brand,
      details.last4,
      details.expMonth,
      details.expYear,
      (count?.n ?? 0) === 0 ? 1 : 0,
      nowIso(),
    );
  }

  function sendExpoPush(token: string, title: string, body: string) {
    void fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to: token, title, body, sound: "default" }),
    }).catch((error: unknown) => {
      console.error("expo push failed", error instanceof Error ? error.message : error);
    });
  }

  function recordReminder(bookingId: string, sessionKey: string, channel: string, subject: string, body: string, userId: string): number {
    const existing = getRow<{ id: string }>(
      db,
      `SELECT id FROM session_reminders WHERE booking_id = ? AND session_key = ? AND channel = ?`,
      bookingId,
      sessionKey,
      channel,
    );
    if (existing) return 0;
    const stamp = nowIso();
    const pages = channel === "email" ? loadCustomerPages(db) : null;
    const stored =
      pages && !body.includes("Any further questions?")
        ? `${body}\n\n${contactQuestion(pages.contactPhone, pages.contactEmail)}`
        : body;
    db.prepare(
      `INSERT INTO session_reminders (id, booking_id, session_key, channel, subject, body, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), bookingId, sessionKey, channel, subject, stored, stamp);
    if (pages) {
      db.prepare(
        `INSERT INTO email_outbox (id, user_id, booking_id, subject, body, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), userId, bookingId, subject, stored, pages.contactEmail, stamp);
    }
    if (channel === "push") {
      db.prepare(`INSERT INTO notifications (id, user_id, booking_id, kind, message, created_at) VALUES (?, ?, ?, 'session_reminder', ?, ?)`).run(
        randomUUID(),
        userId,
        bookingId,
        `${subject}\n${body}`,
        stamp,
      );
    }
    return 1;
  }

  function setting(key: string, fallback: string): string {
    return getRow<{ value: string }>(db, `SELECT value FROM app_settings WHERE key = ?`, key)?.value ?? fallback;
  }

  function assertProfileReady(userId: string) {
    const row = getRow<{ user_id: string }>(db, `SELECT user_id FROM swimmer_profiles WHERE user_id = ?`, userId);
    if (!row) {
      throw new AppError(409, "PROFILE_REQUIRED", "Add your details before paying. We need them to keep you safe in the water.");
    }
  }

  function confirmationMessage(booking: BookingRow): string {
    if (booking.kind === "course" && booking.course_run_id) {
      const run = getRow<CourseRunRow>(db, `SELECT * FROM course_runs WHERE id = ?`, booking.course_run_id);
      const sessions = getRows<{ starts_at: string }>(
        db,
        `SELECT starts_at FROM course_sessions WHERE run_id = ? ORDER BY starts_at`,
        booking.course_run_id,
      );
      const days = sessions
        .map((session) => fromIso(session.starts_at).setZone(ZONE).toFormat("cccc d LLLL, h:mma").toLowerCase())
        .join("\n");
      return [
        `Your crash course ${booking.reference} is confirmed.`,
        run ? `${run.title} at ${run.location}, ${run.address}` : "",
        days,
        "Bookings are non-refundable. You can move each day until 24 hours before it starts.",
      ]
        .filter(Boolean)
        .join("\n");
    }
    const slot = booking.slot_id ? getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, booking.slot_id) : undefined;
    const when = slot ? fromIso(slot.starts_at).setZone(ZONE).toFormat("cccc d LLLL 'at' h:mma").toLowerCase() : "";
    return [
      `Your lesson ${booking.reference} is confirmed.`,
      slot ? `${slot.duration_minutes} minutes. ${when}.` : "",
      slot ? `${slot.location}, ${slot.address}` : "",
      "Bookings are non-refundable. You can move the lesson until 24 hours before it starts.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function notify(userId: string, bookingId: string, kind: string, subject: string, message: string) {
    const stamp = nowIso();
    db.prepare(`INSERT INTO notifications (id, user_id, booking_id, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      randomUUID(),
      userId,
      bookingId,
      kind,
      message,
      stamp,
    );
    const pages = loadCustomerPages(db);
    const mailed = message.includes("Any further questions?") ? message : `${message}\n\n${contactQuestion(pages.contactPhone, pages.contactEmail)}`;
    db.prepare(
      `INSERT INTO email_outbox (id, user_id, booking_id, subject, body, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), userId, bookingId, subject, mailed, pages.contactEmail, stamp);
  }

  function requireUser(userId: string): UserRow {
    const user = getRow<UserRow>(db, `SELECT * FROM users WHERE id = ?`, userId);
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
    return user;
  }

  function requireLocation(locationId: string): LocationRow {
    const location = getRow<LocationRow>(db, `SELECT * FROM locations WHERE id = ?`, locationId);
    if (!location) throw new AppError(404, "NOT_FOUND", "That location doesn't exist.");
    return location;
  }

  function requireSlot(slotId: string): SlotRow {
    const slot = getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, slotId);
    if (!slot) throw new AppError(404, "NOT_FOUND", "That session doesn't exist.");
    return slot;
  }

  function requireCourseRun(runId: string): CourseRunRow {
    const run = getRow<CourseRunRow>(db, `SELECT * FROM course_runs WHERE id = ?`, runId);
    if (!run) throw new AppError(404, "NOT_FOUND", "That course run doesn't exist.");
    return run;
  }

  function requireRule(ruleId: string): AvailabilityRuleRow {
    const rule = getRow<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules WHERE id = ?`, ruleId);
    if (!rule) throw new AppError(404, "NOT_FOUND", "That weekly availability doesn't exist.");
    return rule;
  }

  function courseSessions(runId: string): CourseSessionRow[] {
    return getRows<CourseSessionRow>(
      db,
      `SELECT * FROM course_sessions WHERE run_id = ? ORDER BY day_index`,
      runId,
    );
  }

  function defaultLocation(): LocationRow {
    const fareham = getRow<LocationRow>(db, `SELECT * FROM locations WHERE id = ? AND enabled = 1`, FAREHAM_LOCATION_ID);
    if (fareham) return fareham;
    const first = getRow<LocationRow>(db, `SELECT * FROM locations WHERE enabled = 1 ORDER BY name LIMIT 1`);
    if (!first) throw new AppError(409, "SLOT_UNAVAILABLE", "No pool is open for booking.");
    return first;
  }

  function renumberCourseSessions(runId: string) {
    const sessions = [...courseSessions(runId)].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    db.prepare(`UPDATE course_sessions SET day_index = day_index + 100 WHERE run_id = ?`).run(runId);
    sessions.forEach((session, index) => {
      db.prepare(`UPDATE course_sessions SET day_index = ? WHERE id = ?`).run(index + 1, session.id);
    });
    const first = sessions[0];
    if (!first) return;
    const local = fromIso(first.starts_at).setZone(ZONE);
    db.prepare(`UPDATE course_runs SET first_date = ?, daily_hour = ?, daily_minute = ? WHERE id = ?`).run(
      local.toFormat("yyyy-MM-dd"),
      local.hour,
      local.minute,
      runId,
    );
  }

  function assertSlotBookable(slot: SlotRow) {
    if (Number(slot.enabled) === 0 || Number(slot.cancelled) !== 0) {
      throw new AppError(409, "SLOT_UNAVAILABLE", "This session isn't available.");
    }
  }

  function assertCourseRunBookable(run: CourseRunRow) {
    if (Number(run.enabled) === 0 || Number(run.cancelled) !== 0) {
      throw new AppError(409, "COURSE_UNAVAILABLE", "This course isn't available.");
    }
  }

  function listVisibleSlots(
    now: DateTime,
    userId: string,
    filters?: { locationId?: string; durationMinutes?: number; partySize?: number; excludeBookingId?: string },
  ): SlotDto[] {
    expireStale();
    return listWindowOffers(db, now, userId, filters);
  }

  function listVisibleCourses(now: DateTime, filters?: { locationId?: string; days?: number; partySize?: number }): CourseRunDto[] {
    expireStale();
    const occupied = courseOccupiedMap();
    const params: (string | number)[] = [];
    let sql = `SELECT * FROM course_runs WHERE enabled = 1 AND cancelled = 0`;
    if (filters?.locationId) {
      sql += ` AND location_id = ?`;
      params.push(filters.locationId);
    }
    if (filters?.days !== undefined) {
      sql += ` AND days = ?`;
      params.push(filters.days);
    }
    if (filters?.partySize !== undefined) {
      sql += ` AND capacity = ?`;
      params.push(filters.partySize);
    }
    sql += ` ORDER BY first_date, daily_hour, daily_minute`;
    const rows = getRows<CourseRunRow>(db, sql, ...params);
    return rows
      .map((run) => presentCourseRun(run, courseSessions(run.id), occupied.get(run.id) ?? 0, now))
      .filter((run) => getBookingBlock(fromIso(run.startsAt), now).ok);
  }

  function buildDays(slots: SlotDto[], now: DateTime): DayAvailability[] {
    const ends = lastBookableDay(now);
    const start = now.setZone(ZONE).startOf("day");
    const byDate = new Map<string, SlotDto[]>();
    for (const slot of slots) {
      const list = byDate.get(slot.dateKey) ?? [];
      list.push(slot);
      byDate.set(slot.dateKey, list);
    }
    const days: DayAvailability[] = [];
    for (let day = start; day <= ends; day = day.plus({ days: 1 })) {
      const dateKey = day.toFormat("yyyy-MM-dd");
      const daySlots = byDate.get(dateKey) ?? [];
      if (daySlots.length === 0) continue;
      const openCount = daySlots.filter((slot) => slot.bookable).length;
      days.push({
        dateKey,
        dayLabel: day.toFormat("cccc d LLLL"),
        weekdayShort: day.toFormat("ccc"),
        dayOfMonth: day.day,
        openCount,
        totalCount: daySlots.length,
        selectable: openCount > 0,
      });
    }
    return days;
  }

  function requireOwned(userId: string, bookingId: string): BookingRow {
    const booking = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, bookingId);
    if (!booking || booking.user_id !== userId) {
      throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
    }
    return booking;
  }

  function occupiedMap(): Map<string, number> {
    const rows = getRows<{ slot_id: string; n: number }>(
      db,
      `SELECT slot_id, COUNT(*) AS n FROM bookings
       WHERE slot_id IS NOT NULL
         AND (status = 'confirmed' OR (status = 'pending_payment' AND hold_expires_at > ?))
       GROUP BY slot_id`,
      nowIso(),
    );
    return new Map(rows.map((row) => [row.slot_id, Number(row.n)]));
  }

  function courseOccupiedMap(): Map<string, number> {
    const rows = getRows<{ course_run_id: string; n: number }>(
      db,
      `SELECT course_run_id, COUNT(*) AS n FROM bookings
       WHERE course_run_id IS NOT NULL
         AND (status = 'confirmed' OR (status = 'pending_payment' AND hold_expires_at > ?))
       GROUP BY course_run_id`,
      nowIso(),
    );
    return new Map(rows.map((row) => [row.course_run_id, Number(row.n)]));
  }

  function countOccupied(slotId: string, exceptId: string): number {
    const row = getRow<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM bookings
       WHERE slot_id = ?
         AND id != ?
         AND (
           status = 'confirmed'
           OR (status = 'pending_payment' AND hold_expires_at > ?)
         )`,
      slotId,
      exceptId,
      nowIso(),
    );
    return Number(row?.n ?? 0);
  }

  function countCourseOccupied(runId: string, exceptId: string): number {
    const row = getRow<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM bookings
       WHERE course_run_id = ?
         AND id != ?
         AND (
           status = 'confirmed'
           OR (status = 'pending_payment' AND hold_expires_at > ?)
         )`,
      runId,
      exceptId,
      nowIso(),
    );
    return Number(row?.n ?? 0);
  }

  function toBookingDto(booking: BookingRow): BookingDto {
    const now = clock();
    if (booking.kind === "course") {
      if (!booking.course_run_id) throw new AppError(500, "INTERNAL", "Course booking is missing a run.");
      const run = requireCourseRun(booking.course_run_id);
      const sessions = courseSessions(run.id);
      const occupied = countCourseOccupied(run.id, booking.id);
      return presentBooking(booking, now, { run, sessions, occupied });
    }
    if (!booking.slot_id) throw new AppError(500, "INTERNAL", "Lesson booking is missing a session.");
    const slot = requireSlot(booking.slot_id);
    const occupied = countOccupied(slot.id, booking.id);
    return presentBooking(booking, now, { slot, occupied });
  }

  function bookingSortKey(booking: BookingDto): string {
    return booking.slot?.startsAt ?? booking.course?.startsAt ?? booking.createdAt;
  }

  function toUser(user: UserRow): UserDto {
    return { id: user.id, email: user.email, name: user.name };
  }

  function assertReturnUrl(returnUrl: string) {
    if (!isAllowedReturnUrl(returnUrl, config.appWebUrl)) {
      throw new AppError(400, "VALIDATION", "That return address isn't allowed.");
    }
  }

  async function openCheckout(bookingId: string, reused: boolean): Promise<CheckoutResult> {
    const booking = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, bookingId);
    if (!booking) throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
    const user = requireUser(booking.user_id);
    assertProfileReady(user.id);
    if (booking.kind === "course" && !(booking.course_goal ?? "").trim()) {
      throw new AppError(400, "COURSE_GOAL_REQUIRED", "Tell us what you would like to achieve on the crash course.");
    }
    const presented = toBookingDto(booking);
    const amountPence = presented.payTodayPence > 0 ? presented.payTodayPence : booking.price_pence;
    const saveCard = (booking.balance_pence ?? 0) > 0 && booking.balance_status === "scheduled";
    const title =
      booking.kind === "course"
        ? `Crash course — ${presented.course?.title ?? "course"}`
        : `Adult swimming lesson — ${presented.slot?.title ?? "lesson"}`;
    const description =
      booking.kind === "course"
        ? `${presented.course?.partyLabel ?? "Private"} · ${presented.course?.location ?? ""} · ${presented.course?.dateSummary ?? ""}`
        : `${presented.slot?.partyLabel ?? "Private"} · ${presented.slot?.location ?? ""} · ${presented.slot?.dayLabel ?? ""} ${presented.slot?.timeLabel ?? ""}`;
    try {
      const session = await payments.createCheckout({
        bookingId: booking.id,
        amountPence,
        title: saveCard ? `${title} deposit` : title,
        description,
        customerEmail: user.email,
        reference: booking.reference,
        saveCard,
        purpose: "booking",
      });
      db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE id = ?`).run(session.id, booking.id);
      const fresh = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, booking.id)!;
      return { booking: toBookingDto(fresh), checkoutUrl: session.url, sessionId: session.id };
    } catch (error) {
      if (!reused) {
        db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ? AND status = 'pending_payment'`).run(booking.id);
      }
      if (error instanceof AppError) throw error;
      throw new AppError(502, "PAYMENT_PROVIDER", "Couldn't start payment. The space has been released. Try again.");
    }
  }

  async function syncCalendar(booking: BookingRow): Promise<string | null> {
    const user = requireUser(booking.user_id);
    if (!user.google_refresh_token) return null;
    try {
      let summary: string;
      let description: string;
      let location: string;
      let startsAt: DateTime;
      let endsAt: DateTime;
      if (booking.kind === "course" && booking.course_run_id) {
        const run = requireCourseRun(booking.course_run_id);
        const sessions = courseSessions(run.id);
        const first = sessions[0];
        if (!first) return null;
        summary = `Crash course — ${run.title}`;
        const dayLines = sessions
          .map((session) => {
            const starts = fromIso(session.starts_at).setZone(ZONE);
            const ends = fromIso(session.ends_at).setZone(ZONE);
            return `${starts.toFormat("cccc d LLLL")}, ${starts.toFormat("h:mma").toLowerCase()}–${ends.toFormat("h:mma").toLowerCase()}`;
          })
          .join("\n");
        description = `${BUSINESS_NAME} booking ${booking.reference}. ${run.days}-day adult crash course with ${run.instructor}.\n${dayLines}`;
        location = `${run.location}, ${run.address}`;
        startsAt = fromIso(first.starts_at);
        endsAt = fromIso(first.ends_at);
      } else if (booking.slot_id) {
        const slot = requireSlot(booking.slot_id);
        summary = `Swimming lesson — ${slot.title}`;
        description = `${BUSINESS_NAME} booking ${booking.reference}. Adult swimming lesson with ${slot.instructor}.`;
        location = `${slot.location}, ${slot.address}`;
        startsAt = fromIso(slot.starts_at);
        endsAt = fromIso(slot.ends_at);
      } else {
        return null;
      }
      const result = await calendar.upsertEvent({
        refreshToken: user.google_refresh_token,
        eventId: booking.calendar_event_id,
        summary,
        description,
        location,
        startsAt,
        endsAt,
      });
      db.prepare(`UPDATE bookings SET calendar_event_id = ? WHERE id = ?`).run(result.eventId, booking.id);
      return null;
    } catch (error) {
      console.error("calendar sync failed", error instanceof Error ? error.message : error);
      return CALENDAR_SYNC_WARNING;
    }
  }

  return {
    publicConfig(): PublicConfig {
      return {
        product: "Lido",
        timezone: "Europe/London",
        currency: "GBP",
        maxAdvanceWeeks: MAX_ADVANCE_WEEKS,
        rescheduleCutoffHours: 24,
        holdMinutes: HOLD_MS / 60000,
        paymentsMode: payments.mode,
        calendarConfigured: calendar.configured,
        lessonDurations: [...LESSON_DURATIONS],
        lessonPrices: listLessonRates(db, nowIso()),
        courseLengths: [...COURSE_LENGTHS],
        coursePrices: COURSE_LENGTHS.map((days) => ({
          days,
          pricePence: COURSE_PACKAGE_PRICES[days],
          priceLabel: formatGBP(COURSE_PACKAGE_PRICES[days]),
        })),
        courseDailyMinutes: COURSE_DAILY_MINUTES,
        courseMorningWindow: { startHour: COURSE_MORNING_START_HOUR, endHour: COURSE_MORNING_END_HOUR },
        demoLogin: config.exposeDemoLogin
          ? { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME }
          : null,
      };
    },

    listLocations(): LocationDto[] {
      return getRows<LocationRow>(db, `SELECT * FROM locations WHERE enabled = 1 ORDER BY name`).map(presentLocation);
    },

    register(input: { name: string; email: string; password: string }) {
      const email = input.email.toLowerCase();
      const id = randomUUID();
      try {
        db.prepare(
          `INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`,
        ).run(id, email, input.name.trim(), hashPassword(input.password, config.bcryptRounds), nowIso());
      } catch (error) {
        if (isUniqueError(error)) {
          throw new AppError(409, "EMAIL_TAKEN", "An account with that email already exists.");
        }
        throw error;
      }
      const user = requireUser(id);
      return { token: signAccessToken(user.id, config.jwtSecret), user: toUser(user) };
    },

    login(input: { email: string; password: string }) {
      const user = getRow<UserRow>(db, `SELECT * FROM users WHERE email = ?`, input.email.toLowerCase());
      if (!user || !verifyPassword(input.password, user.password_hash)) {
        throw new AppError(401, "UNAUTHORIZED", "Email or password is incorrect.");
      }
      return { token: signAccessToken(user.id, config.jwtSecret), user: toUser(user) };
    },

    me(userId: string): UserDto {
      return toUser(requireUser(userId));
    },

    listSlots(userId: string, filters?: { locationId?: string; durationMinutes?: number; partySize?: number; excludeBookingId?: string }) {
      requireUser(userId);
      if (filters?.durationMinutes !== undefined) {
        assertLessonDuration(filters.durationMinutes);
      }
      if (filters?.partySize !== undefined && filters.partySize !== 1 && filters.partySize !== 2) {
        throw new AppError(400, "VALIDATION", "Choose 1-to-1 or 1-to-2.");
      }
      if (filters?.locationId) requireLocation(filters.locationId);
      if (filters?.excludeBookingId) requireOwned(userId, filters.excludeBookingId);
      const now = clock();
      const slots = listVisibleSlots(now, userId, filters);
      const ends = lastBookableDay(now);
      return {
        timezone: ZONE,
        maxAdvanceWeeks: MAX_ADVANCE_WEEKS,
        rescheduleCutoffHours: 24,
        windowEndsOn: ends.toFormat("yyyy-MM-dd"),
        windowEndsLabel: ends.toFormat("d LLLL yyyy"),
        days: buildDays(slots, now),
        slots,
      };
    },

    listCourses(userId: string, filters?: { locationId?: string; days?: number; partySize?: number }) {
      requireUser(userId);
      if (filters?.days !== undefined) assertCourseDays(filters.days);
      if (filters?.partySize !== undefined && filters.partySize !== 1 && filters.partySize !== 2) {
        throw new AppError(400, "VALIDATION", "Choose 1-to-1 or 1-to-2.");
      }
      if (filters?.locationId) requireLocation(filters.locationId);
      const now = clock();
      return {
        timezone: ZONE,
        maxAdvanceWeeks: MAX_ADVANCE_WEEKS,
        courses: listVisibleCourses(now, filters),
      };
    },

    getSlot(userId: string, slotId: string): SlotDto {
      requireUser(userId);
      expireStale();
      const slot = requireSlot(slotId);
      return presentSlot(slot, countOccupied(slot.id, ""), clock());
    },

    getCourseRun(userId: string, runId: string): CourseRunDto {
      requireUser(userId);
      expireStale();
      const run = requireCourseRun(runId);
      return presentCourseRun(run, courseSessions(run.id), countCourseOccupied(run.id, ""), clock());
    },

    async createBooking(
      userId: string,
      input: { slotId?: string; courseRunId?: string; returnUrl: string },
    ): Promise<CheckoutResult> {
      const user = requireUser(userId);
      assertReturnUrl(input.returnUrl);
      if (input.slotId && input.courseRunId) {
        throw new AppError(400, "VALIDATION", "Choose either a single lesson or a crash course.");
      }
      if (!input.slotId && !input.courseRunId) {
        throw new AppError(400, "VALIDATION", "Choose a session or course to book.");
      }
      if (input.courseRunId) {
        return this.createCourseBooking(user.id, { courseRunId: input.courseRunId, returnUrl: input.returnUrl });
      }
      expireStale();
      const slot = parseOfferId(input.slotId!)
        ? materializeOffer(db, clock(), input.slotId!)
        : requireSlot(input.slotId!);
      assertSlotBookable(slot);
      const block = getBookingBlock(fromIso(slot.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);

      const created = withTransaction(db, () => {
        expireStale();
        const existing = getRow<BookingRow>(
          db,
          `SELECT * FROM bookings WHERE user_id = ? AND slot_id = ? AND status IN ('pending_payment', 'confirmed')`,
          user.id,
          slot.id,
        );
        if (existing?.status === "confirmed") {
          throw new AppError(409, "ALREADY_BOOKED", "You already have this session booked.");
        }
        const holdUntil = toUtcIso(clock().plus({ milliseconds: HOLD_MS }));
        if (existing?.status === "pending_payment") {
          db.prepare(`UPDATE bookings SET hold_expires_at = ?, return_url = ? WHERE id = ?`).run(
            holdUntil,
            input.returnUrl,
            existing.id,
          );
          return { id: existing.id, reused: true };
        }
        if (countOccupied(slot.id, "") >= slot.capacity) {
          throw new AppError(409, "SLOT_FULL", "This session is full.");
        }
        const id = randomUUID();
        const stamp = nowIso();
        try {
          db.prepare(
            `INSERT INTO bookings (
              id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
              stripe_session_id, stripe_payment_intent, payment_source, return_url,
              calendar_event_id, created_at, confirmed_at, rescheduled_at
            ) VALUES (?, ?, ?, 'lesson', ?, NULL, 'pending_payment', ?, ?, NULL, NULL, NULL, ?, NULL, ?, NULL, NULL)`,
          ).run(id, makeReference(db), user.id, slot.id, holdUntil, lessonPricePence(db, slot.duration_minutes, stamp), input.returnUrl, stamp);
        } catch (error) {
          if (isUniqueError(error)) {
            throw new AppError(409, "ALREADY_BOOKED", "You already have this session booked.");
          }
          throw error;
        }
        return { id, reused: false };
      });

      return openCheckout(created.id, created.reused);
    },

    async createCourseBooking(
      userId: string,
      input: { courseRunId: string; returnUrl: string },
    ): Promise<CheckoutResult> {
      const user = requireUser(userId);
      assertReturnUrl(input.returnUrl);
      expireStale();
      const run = requireCourseRun(input.courseRunId);
      assertCourseRunBookable(run);
      const sessions = courseSessions(run.id);
      const first = sessions[0];
      if (!first) throw new AppError(409, "COURSE_UNAVAILABLE", "This course has no sessions.");
      const block = getBookingBlock(fromIso(first.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);

      const created = withTransaction(db, () => {
        expireStale();
        const existing = getRow<BookingRow>(
          db,
          `SELECT * FROM bookings WHERE user_id = ? AND course_run_id = ? AND status IN ('pending_payment', 'confirmed')`,
          user.id,
          run.id,
        );
        if (existing?.status === "confirmed") {
          throw new AppError(409, "ALREADY_BOOKED", "You already have this course booked.");
        }
        const holdUntil = toUtcIso(clock().plus({ milliseconds: HOLD_MS }));
        if (existing?.status === "pending_payment") {
          db.prepare(`UPDATE bookings SET hold_expires_at = ?, return_url = ? WHERE id = ?`).run(
            holdUntil,
            input.returnUrl,
            existing.id,
          );
          return { id: existing.id, reused: true };
        }
        if (countCourseOccupied(run.id, "") >= run.capacity) {
          throw new AppError(409, "COURSE_FULL", "This course is full.");
        }
        const id = randomUUID();
        const stamp = nowIso();
        try {
          db.prepare(
            `INSERT INTO bookings (
              id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
              stripe_session_id, stripe_payment_intent, payment_source, return_url,
              calendar_event_id, created_at, confirmed_at, rescheduled_at
            ) VALUES (?, ?, ?, 'course', NULL, ?, 'pending_payment', ?, ?, NULL, NULL, NULL, ?, NULL, ?, NULL, NULL)`,
          ).run(id, makeReference(db), user.id, run.id, holdUntil, run.price_pence, input.returnUrl, stamp);
        } catch (error) {
          if (isUniqueError(error)) {
            throw new AppError(409, "ALREADY_BOOKED", "You already have this course booked.");
          }
          throw error;
        }
        return { id, reused: false };
      });

      return openCheckout(created.id, created.reused);
    },

    async refreshCheckout(userId: string, bookingId: string, returnUrl: string): Promise<CheckoutResult> {
      requireUser(userId);
      assertReturnUrl(returnUrl);
      expireStale();
      const booking = requireOwned(userId, bookingId);
      if (booking.status === "confirmed") {
        throw new AppError(409, "ALREADY_BOOKED", "This booking is already paid.");
      }
      if (booking.status !== "pending_payment") {
        throw new AppError(409, "HOLD_EXPIRED", "The hold expired. Book again.");
      }
      if (booking.kind === "course" && booking.course_run_id) {
        const run = requireCourseRun(booking.course_run_id);
        const first = courseSessions(run.id)[0];
        if (!first) throw new AppError(409, "COURSE_UNAVAILABLE", "This course has no sessions.");
        const block = getBookingBlock(fromIso(first.starts_at), clock());
        if (!block.ok) throw new AppError(400, block.code, block.message);
      } else if (booking.slot_id) {
        const slot = requireSlot(booking.slot_id);
        const block = getBookingBlock(fromIso(slot.starts_at), clock());
        if (!block.ok) throw new AppError(400, block.code, block.message);
      }
      const holdUntil = toUtcIso(clock().plus({ milliseconds: HOLD_MS }));
      db.prepare(`UPDATE bookings SET hold_expires_at = ?, return_url = ? WHERE id = ?`).run(holdUntil, returnUrl, booking.id);
      return openCheckout(booking.id, true);
    },

    async confirmPaidSession(sessionId: string, actorUserId?: string): Promise<MutationResult> {
      const verified = await payments.verifyPaid(sessionId);
      if (!verified.paid || !verified.bookingId) {
        throw new AppError(402, "PAYMENT_REQUIRED", "Payment hasn't completed yet.");
      }
      const pre = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, verified.bookingId);
      if (!pre) throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
      if (actorUserId && pre.user_id !== actorUserId) {
        throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
      }
      if (verified.purpose === "balance") {
        db.prepare(`UPDATE bookings SET balance_status = 'paid', balance_paid_at = ?, stripe_payment_intent = ? WHERE id = ?`).run(
          nowIso(),
          verified.paymentIntentId,
          pre.id,
        );
        const settled = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, pre.id)!;
        return { booking: toBookingDto(settled), calendarSyncError: null, returnUrl: settled.return_url };
      }

      const confirmedIdsResult = withTransaction(db, () => {
        expireStale();
        const linked = getRows<BookingRow>(
          db,
          `SELECT * FROM bookings WHERE id = ? OR stripe_session_id = ?`,
          verified.bookingId,
          sessionId,
        );
        const rows = linked.length > 0 ? linked : [getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, verified.bookingId!)].filter(Boolean) as BookingRow[];
        if (rows.length === 0) throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
        const source = payments.mode === "stripe" ? "stripe" : "mock";
        const ids: string[] = [];
        const freshIds: string[] = [];
        for (const booking of rows) {
          if (booking.status === "confirmed") {
            ids.push(booking.id);
            continue;
          }
          if (booking.status !== "pending_payment" && booking.status !== "expired") {
            throw new AppError(409, "BOOKING_CLOSED", "This booking can no longer be confirmed.");
          }
          if (booking.kind === "course" && booking.course_run_id) {
            const run = requireCourseRun(booking.course_run_id);
            if (booking.status !== "pending_payment" && countCourseOccupied(run.id, booking.id) >= run.capacity) {
              throw new AppError(409, "COURSE_TAKEN", COURSE_TAKEN_MESSAGE);
            }
          } else if (booking.slot_id) {
            const slot = requireSlot(booking.slot_id);
            if (booking.status !== "pending_payment" && countOccupied(slot.id, booking.id) >= slot.capacity) {
              throw new AppError(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);
            }
          }
          db.prepare(
            `UPDATE bookings
             SET status = 'confirmed', confirmed_at = ?, stripe_session_id = ?, stripe_payment_intent = ?, payment_source = ?
             WHERE id = ?`,
          ).run(nowIso(), sessionId, verified.paymentIntentId, source, booking.id);
          if (verified.customerId && verified.paymentMethodId) {
            db.prepare(`UPDATE bookings SET stripe_customer_id = ?, stripe_payment_method_id = ? WHERE id = ?`).run(
              verified.customerId,
              verified.paymentMethodId,
              booking.id,
            );
            db.prepare(`UPDATE users SET stripe_customer_id = ?, stripe_payment_method_id = ? WHERE id = ?`).run(
              verified.customerId,
              verified.paymentMethodId,
              booking.user_id,
            );
          }
          ids.push(booking.id);
          freshIds.push(booking.id);
        }
        return { ids, freshIds };
      });
      const confirmedIds = confirmedIdsResult.ids;

      if (verified.customerId && verified.paymentMethodId && confirmedIds[0]) {
        const owner = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, confirmedIds[0]);
        if (owner) await rememberCard(owner.user_id, verified.customerId, verified.paymentMethodId);
      }

      for (const id of confirmedIdsResult.freshIds) {
        const row = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, id);
        if (!row) continue;
        notify(row.user_id, row.id, "booking_confirmed", `Booking confirmed — ${row.reference}`, confirmationMessage(row));
      }

      let calendarSyncError: string | null = null;
      for (const id of confirmedIds) {
        const row = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, id);
        if (!row) continue;
        const syncError = await syncCalendar(row);
        if (syncError) calendarSyncError = syncError;
      }
      const fresh = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, confirmedIds[0])!;
      return { booking: toBookingDto(fresh), calendarSyncError, returnUrl: fresh.return_url };
    },

    listBookings(userId: string): BookingDto[] {
      requireUser(userId);
      expireStale();
      const rows = getRows<BookingRow>(
        db,
        `SELECT * FROM bookings WHERE user_id = ? AND status IN ('pending_payment', 'confirmed', 'cancelled')`,
        userId,
      );
      return rows.map((row) => toBookingDto(row)).sort((a, b) => bookingSortKey(a).localeCompare(bookingSortKey(b)));
    },

    getBooking(userId: string, bookingId: string): BookingDto {
      requireUser(userId);
      expireStale();
      return toBookingDto(requireOwned(userId, bookingId));
    },

    async reschedule(
      userId: string,
      bookingId: string,
      input: { slotId?: string; courseRunId?: string },
    ): Promise<MutationResult> {
      requireUser(userId);
      const booking = requireOwned(userId, bookingId);
      if (booking.kind === "course") {
        if (!input.courseRunId) {
          throw new AppError(400, "VALIDATION", "Choose another course run.");
        }
        return this.rescheduleCourse(userId, bookingId, input.courseRunId);
      }
      if (!input.slotId) {
        throw new AppError(400, "VALIDATION", "Choose a session.");
      }
      if (booking.status !== "confirmed") {
        throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before rearranging this lesson.");
      }
      const current = requireSlot(booking.slot_id!);
      const decision = getRescheduleBlock(fromIso(current.starts_at), clock());
      if (!decision.ok) throw new AppError(409, decision.code, decision.message);
      if (parseOfferId(input.slotId)) materializeOffer(db, clock(), input.slotId, bookingId);
      if (input.slotId === current.id) throw new AppError(400, "VALIDATION", "Choose a different session.");
      const next = requireSlot(input.slotId);
      assertSlotBookable(next);
      const block = getBookingBlock(fromIso(next.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);

      withTransaction(db, () => {
        expireStale();
        const again = requireOwned(userId, bookingId);
        if (again.status !== "confirmed") {
          throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before rearranging this lesson.");
        }
        const currentAgain = requireSlot(again.slot_id!);
        const decisionAgain = getRescheduleBlock(fromIso(currentAgain.starts_at), clock());
        if (!decisionAgain.ok) throw new AppError(409, decisionAgain.code, decisionAgain.message);
        const nextAgain = requireSlot(input.slotId!);
        assertSlotBookable(nextAgain);
        const nextBlock = getBookingBlock(fromIso(nextAgain.starts_at), clock());
        if (!nextBlock.ok) throw new AppError(400, nextBlock.code, nextBlock.message);
        if (countOccupied(nextAgain.id, again.id) >= nextAgain.capacity) {
          throw new AppError(409, "SLOT_FULL", "That session is full.");
        }
        assertStoredSlotOpen(db, clock(), nextAgain, again.id);
        const stamp = nowIso();
        try {
          db.prepare(`UPDATE bookings SET slot_id = ?, rescheduled_at = ? WHERE id = ?`).run(nextAgain.id, stamp, again.id);
        } catch (error) {
          if (isUniqueError(error)) {
            throw new AppError(409, "ALREADY_BOOKED", "You already have a booking for that session.");
          }
          throw error;
        }
        db.prepare(
          `INSERT INTO booking_events (id, booking_id, type, from_slot_id, to_slot_id, created_at)
           VALUES (?, ?, 'rescheduled', ?, ?, ?)`,
        ).run(randomUUID(), again.id, currentAgain.id, nextAgain.id, stamp);
      });

      const moved = requireOwned(userId, bookingId);
      const calendarSyncError = await syncCalendar(moved);
      const fresh = requireOwned(userId, bookingId);
      return { booking: toBookingDto(fresh), calendarSyncError, returnUrl: fresh.return_url };
    },

    async rescheduleCourse(userId: string, bookingId: string, courseRunId: string): Promise<MutationResult> {
      requireUser(userId);
      const booking = requireOwned(userId, bookingId);
      if (booking.kind !== "course" || !booking.course_run_id) {
        throw new AppError(400, "VALIDATION", "This booking isn't a crash course.");
      }
      if (booking.status !== "confirmed") {
        throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before moving this course.");
      }
      const current = requireCourseRun(booking.course_run_id);
      const currentSessions = courseSessions(current.id);
      const currentFirst = currentSessions[0];
      if (!currentFirst) throw new AppError(409, "COURSE_UNAVAILABLE", "This course has no sessions.");
      const decision = getRescheduleBlock(fromIso(currentFirst.starts_at), clock());
      if (!decision.ok) throw new AppError(409, decision.code, decision.message);
      if (courseRunId === current.id) throw new AppError(400, "VALIDATION", "Choose a different course run.");
      const next = requireCourseRun(courseRunId);
      if (next.days !== current.days) {
        throw new AppError(400, "VALIDATION", `Choose another ${current.days}-day course run.`);
      }
      assertCourseRunBookable(next);
      const nextSessions = courseSessions(next.id);
      const nextFirst = nextSessions[0];
      if (!nextFirst) throw new AppError(409, "COURSE_UNAVAILABLE", "That course has no sessions.");
      const block = getBookingBlock(fromIso(nextFirst.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);

      withTransaction(db, () => {
        expireStale();
        const again = requireOwned(userId, bookingId);
        if (again.status !== "confirmed") {
          throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before moving this course.");
        }
        const currentAgain = requireCourseRun(again.course_run_id!);
        const currentFirstAgain = courseSessions(currentAgain.id)[0];
        if (!currentFirstAgain) throw new AppError(409, "COURSE_UNAVAILABLE", "This course has no sessions.");
        const decisionAgain = getRescheduleBlock(fromIso(currentFirstAgain.starts_at), clock());
        if (!decisionAgain.ok) throw new AppError(409, decisionAgain.code, decisionAgain.message);
        const nextAgain = requireCourseRun(courseRunId);
        if (nextAgain.days !== currentAgain.days) {
          throw new AppError(400, "VALIDATION", `Choose another ${currentAgain.days}-day course run.`);
        }
        assertCourseRunBookable(nextAgain);
        const nextFirstAgain = courseSessions(nextAgain.id)[0];
        if (!nextFirstAgain) throw new AppError(409, "COURSE_UNAVAILABLE", "That course has no sessions.");
        const nextBlock = getBookingBlock(fromIso(nextFirstAgain.starts_at), clock());
        if (!nextBlock.ok) throw new AppError(400, nextBlock.code, nextBlock.message);
        if (countCourseOccupied(nextAgain.id, again.id) >= nextAgain.capacity) {
          throw new AppError(409, "COURSE_FULL", "That course is full.");
        }
        const stamp = nowIso();
        try {
          db.prepare(`UPDATE bookings SET course_run_id = ?, rescheduled_at = ? WHERE id = ?`).run(
            nextAgain.id,
            stamp,
            again.id,
          );
        } catch (error) {
          if (isUniqueError(error)) {
            throw new AppError(409, "ALREADY_BOOKED", "You already have a booking for that course.");
          }
          throw error;
        }
        db.prepare(
          `INSERT INTO booking_events (
            id, booking_id, type, from_course_run_id, to_course_run_id, created_at
          ) VALUES (?, ?, 'rescheduled', ?, ?, ?)`,
        ).run(randomUUID(), again.id, currentAgain.id, nextAgain.id, stamp);
      });

      const moved = requireOwned(userId, bookingId);
      const calendarSyncError = await syncCalendar(moved);
      const fresh = requireOwned(userId, bookingId);
      return { booking: toBookingDto(fresh), calendarSyncError, returnUrl: fresh.return_url };
    },

    async syncBookingCalendar(userId: string, bookingId: string): Promise<BookingDto> {
      const user = requireUser(userId);
      if (!user.google_refresh_token) {
        throw new AppError(
          409,
          "CALENDAR_NOT_CONNECTED",
          "Connect Google Calendar on your account first, or use the add-to-calendar link.",
        );
      }
      const booking = requireOwned(userId, bookingId);
      if (booking.status !== "confirmed") {
        throw new AppError(409, "PAYMENT_REQUIRED", "Finish payment before adding this booking to your calendar.");
      }
      const error = await syncCalendar(booking);
      if (error) throw new AppError(502, "CALENDAR_SYNC", error);
      return toBookingDto(requireOwned(userId, bookingId));
    },

    calendarStatus(userId: string) {
      const user = requireUser(userId);
      return {
        configured: calendar.configured,
        connected: Boolean(user.google_refresh_token),
        email: user.google_email,
        setupHint: calendar.configured
          ? null
          : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API, then restart it. Until then, each booking has an Add to Google Calendar link.",
      };
    },

    calendarAuthUrl(userId: string, returnUrl: string): string {
      requireUser(userId);
      assertReturnUrl(returnUrl);
      if (!calendar.configured) {
        throw new AppError(
          503,
          "CALENDAR_NOT_CONFIGURED",
          "Google Calendar isn't configured on the server yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or use Add to Google Calendar on a booking.",
        );
      }
      return calendar.authUrl(signOAuthState({ sub: userId, returnUrl }, config.jwtSecret));
    },

    async calendarCallback(code: string | null, state: string | null, providerError: string | null) {
      const parsed = readOAuthState(state ?? "", config.jwtSecret);
      assertReturnUrl(parsed.returnUrl);
      if (providerError || !code) {
        return { returnUrl: parsed.returnUrl, ok: false, message: "Google Calendar wasn't connected." };
      }
      try {
        const tokens = await calendar.exchangeCode(code);
        if (!tokens.refreshToken) {
          return {
            returnUrl: parsed.returnUrl,
            ok: false,
            message: `Google didn't return a refresh token. Remove ${BUSINESS_NAME}'s access in your Google Account permissions and try again.`,
          };
        }
        db.prepare(`UPDATE users SET google_refresh_token = ?, google_email = ? WHERE id = ?`).run(
          tokens.refreshToken,
          tokens.email,
          parsed.sub,
        );
        return { returnUrl: parsed.returnUrl, ok: true, message: "Google Calendar connected." };
      } catch (error) {
        console.error("calendar connect failed", error instanceof Error ? error.message : error);
        return {
          returnUrl: parsed.returnUrl,
          ok: false,
          message: "Google Calendar couldn't be connected. Check the OAuth client settings and try again.",
        };
      }
    },

    disconnectCalendar(userId: string) {
      requireUser(userId);
      db.prepare(`UPDATE users SET google_refresh_token = NULL, google_email = NULL WHERE id = ?`).run(userId);
      return this.calendarStatus(userId);
    },

    previewMockCheckout(token: string) {
      if (!("peekToken" in payments)) {
        throw new AppError(404, "NOT_FOUND", "Test payments are switched off. This server is using Stripe.");
      }
      const peeked = (payments as MockPaymentsPeek).peekToken(token);
      const booking = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, peeked.bookingId);
      if (!booking) throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
      const group = booking.stripe_session_id
        ? getRows<BookingRow>(db, `SELECT * FROM bookings WHERE stripe_session_id = ?`, booking.stripe_session_id)
        : [booking];
      const totalPence = group.reduce((sum, row) => sum + row.price_pence, 0);
      const presented = toBookingDto(booking);
      if (group.length > 1) {
        return {
          token,
          sessionId: peeked.sessionId,
          reference: group.map((row) => row.reference).join(", "),
          title: `${group.length} swimming lessons`,
          dayLabel: "Several lessons",
          timeLabel: group.map((row) => formatGBP(row.price_pence)).join(" + "),
          location: presented.slot?.location ?? presented.course?.location ?? "",
          priceLabel: formatGBP(totalPence),
          alreadyPaid: peeked.paid || group.every((row) => row.status === "confirmed"),
        };
      }
      if (booking.kind === "course" && presented.course) {
        return {
          token,
          sessionId: peeked.sessionId,
          reference: booking.reference,
          title: presented.course.title,
          dayLabel: presented.course.dateSummary,
          timeLabel: `${presented.course.dailyTimeLabel} daily · ${presented.course.dailyMinutes} min`,
          location: presented.course.location,
          priceLabel: presented.payTodayPence > 0 ? presented.payTodayLabel : presented.priceLabel,
          alreadyPaid: peeked.paid || (booking.status === "confirmed" && presented.balanceStatus !== "overdue"),
          balanceNote:
            presented.balancePence > 0
              ? `Deposit today ${presented.depositLabel}. Balance ${presented.balanceLabel} is due ${presented.balanceDueLabel}. The deposit is non-refundable.`
              : "The full course fee is due today because it starts within 4 weeks. This payment is non-refundable.",
        };
      }
      const slot = requireSlot(booking.slot_id!);
      const slotPresented = presentSlot(slot, 0, clock());
      return {
        token,
        sessionId: peeked.sessionId,
        reference: booking.reference,
        title: slot.title,
        dayLabel: slotPresented.dayLabel,
        timeLabel: slotPresented.timeLabel,
        location: slot.location,
        priceLabel: presented.priceLabel,
        alreadyPaid: peeked.paid || booking.status === "confirmed",
      };
    },

    profile(userId: string) {
      requireUser(userId);
      const row = getRow<ProfileRow>(db, `SELECT * FROM swimmer_profiles WHERE user_id = ?`, userId);
      return {
        complete: Boolean(row),
        consentText: "I confirm these details are accurate and consent to Swim School Academy storing them to keep me safe in lessons",
        swimmingLevels: [
          { id: "scared", label: "Scared non-swimmer" },
          { id: "basic", label: "Basic swim skills" },
          { id: "improver", label: "Improver" },
          { id: "advanced", label: "Advanced swimmer" },
        ],
        profile: row
          ? {
              fullName: row.full_name,
              addressLine1: row.address_line1,
              addressLine2: row.address_line2,
              town: row.town,
              postcode: row.postcode,
              dateOfBirth: row.date_of_birth,
              phone: row.phone,
              emergencyName: row.emergency_name,
              emergencyRelationship: row.emergency_relationship,
              emergencyPhone: row.emergency_phone,
              medicalNone: row.medical_none === 1,
              medicalNotes: row.medical_notes,
              swimmingLevel: row.swimming_level,
            }
          : null,
      };
    },

    saveProfile(userId: string, input: ProfileInput) {
      requireUser(userId);
      const clean = assertProfileInput(input, clock());
      const stamp = nowIso();
      db.prepare(
        `INSERT INTO swimmer_profiles (
          user_id, full_name, address_line1, address_line2, town, postcode, date_of_birth, phone,
          emergency_name, emergency_relationship, emergency_phone, medical_none, medical_notes,
          swimming_level, consent_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          full_name = excluded.full_name,
          address_line1 = excluded.address_line1,
          address_line2 = excluded.address_line2,
          town = excluded.town,
          postcode = excluded.postcode,
          date_of_birth = excluded.date_of_birth,
          phone = excluded.phone,
          emergency_name = excluded.emergency_name,
          emergency_relationship = excluded.emergency_relationship,
          emergency_phone = excluded.emergency_phone,
          medical_none = excluded.medical_none,
          medical_notes = excluded.medical_notes,
          swimming_level = excluded.swimming_level,
          consent_at = excluded.consent_at,
          updated_at = excluded.updated_at`,
      ).run(
        userId,
        clean.fullName,
        clean.addressLine1,
        clean.addressLine2,
        clean.town,
        clean.postcode,
        clean.dateOfBirth,
        clean.phone,
        clean.emergencyName,
        clean.emergencyRelationship,
        clean.emergencyPhone,
        clean.medicalNone ? 1 : 0,
        clean.medicalNotes,
        clean.swimmingLevel,
        stamp,
        stamp,
      );
      return this.profile(userId);
    },

    editableCustomerPages() {
      return loadCustomerPages(db);
    },

    customerPages(userId: string) {
      requireUser(userId);
      const profile = getRow<{ swimming_level: string }>(db, `SELECT swimming_level FROM swimmer_profiles WHERE user_id = ?`, userId);
      return presentCustomerPages(loadCustomerPages(db), profile?.swimming_level ?? null);
    },

    saveCustomerPages(input: CustomerPages) {
      return presentCustomerPages(saveCustomerPages(db, input, nowIso()), null);
    },

    saveCourseNotes(userId: string, bookingId: string, input: { goal: string; comments?: string }) {
      const booking = requireOwned(userId, bookingId);
      if (booking.kind !== "course") throw new AppError(400, "VALIDATION", "That booking isn't a crash course.");
      const goal = input.goal.trim();
      if (goal.length < 2) throw new AppError(400, "VALIDATION", "Tell us what you would like to achieve on the crash course.");
      db.prepare(`UPDATE bookings SET course_goal = ?, course_comments = ? WHERE id = ?`).run(goal, (input.comments ?? "").trim(), booking.id);
      return toBookingDto(requireOwned(userId, bookingId));
    },

    notifications(userId: string) {
      requireUser(userId);
      return getRows<{ id: string; kind: string; message: string; created_at: string }>(
        db,
        `SELECT id, kind, message, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`,
        userId,
      );
    },

    async runBalanceSweep(asOf?: DateTime) {
      const now = asOf ?? clock();
      const rows = getRows<BookingRow>(
        db,
        `SELECT * FROM bookings
         WHERE kind = 'course' AND status = 'confirmed' AND balance_status = 'scheduled' AND balance_pence > 0`,
      );
      let reminded = 0;
      let charged = 0;
      let overdue = 0;
      for (const row of rows) {
        if (!row.balance_due_at || !row.balance_pence) continue;
        const due = fromIso(row.balance_due_at);
        const remindAt = due.minus({ days: BALANCE_REMINDER_DAYS });
        if (!row.balance_reminder_sent_at && now.toMillis() >= remindAt.toMillis() && now.toMillis() < due.toMillis()) {
          const message = `Your crash course balance of ${formatGBP(row.balance_pence)} will be taken on ${formatDeadline(due)}.`;
          notify(row.user_id, row.id, "balance_reminder", "Crash course balance reminder", message);
          db.prepare(`UPDATE bookings SET balance_reminder_sent_at = ? WHERE id = ?`).run(toUtcIso(now), row.id);
          reminded += 1;
        }
        if (now.toMillis() >= due.toMillis()) {
          const saved = getRow<CardRow>(
            db,
            `SELECT * FROM payment_cards WHERE user_id = ? ORDER BY is_default DESC, created_at LIMIT 1`,
            row.user_id,
          );
          const result = await payments.chargeOffSession({
            customerId: saved?.stripe_customer_id ?? row.stripe_customer_id ?? "",
            paymentMethodId: saved?.stripe_payment_method_id ?? row.stripe_payment_method_id ?? "",
            amountPence: row.balance_pence,
            bookingId: row.id,
            description: `Crash course balance ${row.reference}`,
          });
          if (result.ok) {
            db.prepare(`UPDATE bookings SET balance_status = 'paid', balance_paid_at = ?, stripe_payment_intent = ? WHERE id = ?`).run(
              toUtcIso(now),
              result.paymentIntentId,
              row.id,
            );
            notify(row.user_id, row.id, "balance_paid", "Crash course balance paid", `We've taken the remaining ${formatGBP(row.balance_pence)}.`);
            charged += 1;
          } else {
            db.prepare(`UPDATE bookings SET balance_status = 'overdue' WHERE id = ?`).run(row.id);
            notify(
              row.user_id,
              row.id,
              "balance_overdue",
              "Crash course balance overdue",
              `We couldn't take the remaining ${formatGBP(row.balance_pence)}. Pay now from My lessons. ${config.appWebUrl}/booking/${row.id}`,
            );
            overdue += 1;
          }
        }
      }
      return { reminded, charged, overdue };
    },

    async startBalanceCheckout(userId: string, bookingId: string, returnUrl: string): Promise<CheckoutResult> {
      assertReturnUrl(returnUrl);
      const booking = requireOwned(userId, bookingId);
      if (booking.balance_status !== "overdue" || !booking.balance_pence) {
        throw new AppError(409, "VALIDATION", "This booking doesn't have a balance to pay.");
      }
      const user = requireUser(userId);
      const session = await payments.createCheckout({
        bookingId: booking.id,
        amountPence: booking.balance_pence,
        title: "Crash course balance",
        description: `Remaining balance for ${booking.reference}`,
        customerEmail: user.email,
        reference: booking.reference,
        purpose: "balance",
      });
      return { booking: toBookingDto(booking), checkoutUrl: session.url, sessionId: session.id };
    },

    listAdminCourseBookings() {
      return getRows<BookingRow & ProfileRow>(
        db,
        `SELECT b.*, p.full_name, p.address_line1, p.address_line2, p.town, p.postcode, p.date_of_birth, p.phone,
                p.emergency_name, p.emergency_relationship, p.emergency_phone, p.medical_none, p.medical_notes, p.swimming_level
         FROM bookings b
         LEFT JOIN swimmer_profiles p ON p.user_id = b.user_id
         WHERE b.kind = 'course' AND b.status IN ('pending_payment', 'confirmed')
         ORDER BY b.created_at DESC
         LIMIT 40`,
      ).map((row) => ({
        id: row.id,
        reference: row.reference,
        status: row.status,
        priceLabel: formatGBP(row.price_pence),
        depositLabel: formatGBP(row.deposit_pence ?? row.price_pence),
        balanceLabel: formatGBP(row.balance_pence ?? 0),
        balanceStatus: row.balance_status ?? "not_required",
        balanceDueLabel: row.balance_due_at ? formatDeadline(fromIso(row.balance_due_at)) : null,
        goal: row.course_goal,
        comments: row.course_comments,
        swimmer: row.full_name
          ? {
              fullName: row.full_name,
              address: [row.address_line1, row.address_line2, row.town, row.postcode].filter(Boolean).join(", "),
              dateOfBirth: row.date_of_birth,
              phone: row.phone,
              emergency: `${row.emergency_name} (${row.emergency_relationship}) ${row.emergency_phone}`,
              swimmingLevel: row.swimming_level,
              medical: row.medical_none === 1 ? "None" : row.medical_notes,
            }
          : null,
      }));
    },

    listCards(userId: string) {
      requireUser(userId);
      return getRows<CardRow>(db, `SELECT * FROM payment_cards WHERE user_id = ? ORDER BY is_default DESC, created_at`, userId).map(
        (card) => ({
          id: card.id,
          brand: card.brand,
          last4: card.last4,
          expMonth: card.exp_month,
          expYear: card.exp_year,
          isDefault: card.is_default === 1,
        }),
      );
    },

    async addMockCard(userId: string, input: { brand?: string; last4: string; expMonth: number; expYear: number }) {
      requireUser(userId);
      if (!/^\d{4}$/.test(input.last4)) {
        throw new AppError(400, "VALIDATION", "Save only the last four digits. The full card number stays with Stripe.");
      }
      const id = randomUUID();
      const count = getRow<{ n: number }>(db, `SELECT COUNT(*) AS n FROM payment_cards WHERE user_id = ?`, userId);
      db.prepare(
        `INSERT INTO payment_cards (
          id, user_id, stripe_customer_id, stripe_payment_method_id, brand, last4, exp_month, exp_year, is_default, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        userId,
        `mock_cus_${userId}`,
        `mock_pm_${id}`,
        (input.brand ?? "visa").slice(0, 20),
        input.last4,
        input.expMonth,
        input.expYear,
        (count?.n ?? 0) === 0 ? 1 : 0,
        nowIso(),
      );
      return this.listCards(userId);
    },

    setDefaultCard(userId: string, cardId: string) {
      requireUser(userId);
      const card = getRow<CardRow>(db, `SELECT * FROM payment_cards WHERE id = ? AND user_id = ?`, cardId, userId);
      if (!card) throw new AppError(404, "NOT_FOUND", "That card doesn't exist.");
      db.prepare(`UPDATE payment_cards SET is_default = 0 WHERE user_id = ?`).run(userId);
      db.prepare(`UPDATE payment_cards SET is_default = 1 WHERE id = ?`).run(cardId);
      return this.listCards(userId);
    },

    removeCard(userId: string, cardId: string) {
      requireUser(userId);
      const card = getRow<CardRow>(db, `SELECT * FROM payment_cards WHERE id = ? AND user_id = ?`, cardId, userId);
      if (!card) throw new AppError(404, "NOT_FOUND", "That card doesn't exist.");
      db.prepare(`DELETE FROM payment_cards WHERE id = ?`).run(cardId);
      if (card.is_default === 1) {
        const next = getRow<{ id: string }>(db, `SELECT id FROM payment_cards WHERE user_id = ? ORDER BY created_at LIMIT 1`, userId);
        if (next) db.prepare(`UPDATE payment_cards SET is_default = 1 WHERE id = ?`).run(next.id);
      }
      return this.listCards(userId);
    },

    notificationSettings(userId: string) {
      const user = requireUser(userId);
      return {
        pushOptOut: user.push_opt_out === 1,
        emailStaysOn: true,
      };
    },

    saveNotificationSettings(userId: string, input: { pushOptOut?: boolean; expoPushToken?: string | null }) {
      requireUser(userId);
      const current = requireUser(userId);
      db.prepare(`UPDATE users SET push_opt_out = ?, expo_push_token = ? WHERE id = ?`).run(
        input.pushOptOut === undefined ? current.push_opt_out : input.pushOptOut ? 1 : 0,
        input.expoPushToken === undefined ? current.expo_push_token : input.expoPushToken,
        userId,
      );
      return this.notificationSettings(userId);
    },

    async runSessionReminders(asOf?: DateTime) {
      if (setting("reminders_enabled", "1") !== "1") return { sent: 0, skipped: true };
      const now = asOf ?? clock();
      const horizon = now.plus({ hours: 24 });
      const due = (startsAt: string) => {
        const start = fromIso(startsAt);
        return start.toMillis() > now.toMillis() && start.toMillis() <= horizon.toMillis();
      };
      const lessons = getRows<{ booking_id: string; user_id: string; starts_at: string; ends_at: string; address: string; reference: string }>(
        db,
        `SELECT b.id AS booking_id, b.user_id, b.reference, s.starts_at, s.ends_at, s.address
         FROM bookings b JOIN slots s ON s.id = b.slot_id
         WHERE b.kind = 'lesson' AND b.status = 'confirmed'`,
      ).filter((row) => due(row.starts_at));
      const courseDays = getRows<{ booking_id: string; user_id: string; starts_at: string; ends_at: string; address: string; reference: string; session_id: string }>(
        db,
        `SELECT b.id AS booking_id, b.user_id, b.reference, cs.id AS session_id, cs.starts_at, cs.ends_at, r.address
         FROM bookings b
         JOIN course_runs r ON r.id = b.course_run_id
         JOIN course_sessions cs ON cs.run_id = r.id
         WHERE b.kind = 'course' AND b.status = 'confirmed'`,
      ).filter((row) => due(row.starts_at));
      let sent = 0;
      const queue = [
        ...lessons.map((row) => ({ ...row, sessionKey: `lesson:${row.starts_at}`, length: "single lesson" })),
        ...courseDays.map((row) => ({ ...row, sessionKey: `course:${row.session_id}:${row.starts_at}`, length: "90 minute course day" })),
      ];
      for (const item of queue) {
        const user = requireUser(item.user_id);
        const when = fromIso(item.starts_at).setZone(ZONE);
        const body = [
          `Your session is ${when.toFormat("cccc d LLLL")} at ${when.toFormat("h:mma").toLowerCase()}.`,
          `Length: ${item.length}.`,
          `Where: ${item.address}.`,
          `How to arrive: ${config.appWebUrl}/arrival`,
          "You can no longer rearrange this session. Changes close 24 hours before the start.",
        ].join("\n");
        const subject = `Tomorrow's swim — ${item.reference}`;
        sent += recordReminder(item.booking_id, item.sessionKey, "email", subject, body, item.user_id);
        if (user.push_opt_out !== 1) {
          const pushed = recordReminder(item.booking_id, item.sessionKey, "push", subject, body, item.user_id);
          sent += pushed;
          if (pushed && user.expo_push_token) void sendExpoPush(user.expo_push_token, subject, body);
        }
      }
      return { sent, skipped: false };
    },

    reminderAdmin() {
      return {
        enabled: setting("reminders_enabled", "1") === "1",
        log: getRows<{ booking_id: string; channel: string; subject: string; body: string; sent_at: string }>(
          db,
          `SELECT booking_id, channel, subject, body, sent_at FROM session_reminders ORDER BY sent_at DESC LIMIT 40`,
        ),
      };
    },

    setReminderSettings(input: { enabled?: boolean }) {
      const stamp = nowIso();
      if (input.enabled !== undefined) {
        db.prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('reminders_enabled', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(input.enabled ? "1" : "0", stamp);
      }
      return this.reminderAdmin();
    },

    listAdminCustomers() {
      return getRows<{ id: string; name: string; email: string; brand: string | null; last4: string | null }>(
        db,
        `SELECT u.id, u.name, u.email, c.brand, c.last4
         FROM users u
         LEFT JOIN payment_cards c ON c.user_id = u.id AND c.is_default = 1
         ORDER BY u.created_at DESC
         LIMIT 40`,
      ).map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        card: user.last4 ? `${user.brand ?? "card"} •••• ${user.last4}` : "No card saved",
        bookings: getRows<{ reference: string; status: string; kind: string }>(
          db,
          `SELECT reference, status, kind FROM bookings WHERE user_id = ? AND status IN ('confirmed', 'pending_payment') ORDER BY created_at DESC LIMIT 8`,
          user.id,
        ),
      }));
    },

    listAdminLocations(): LocationDto[] {
      return getRows<LocationRow>(db, `SELECT * FROM locations ORDER BY name`).map(presentLocation);
    },

    createAdminLocation(input: {
      name: string;
      address: string;
      enabled?: boolean;
      arrivalInstructions?: string;
      latitude?: number | null;
      longitude?: number | null;
    }): LocationDto {
      const id = randomUUID();
      const stamp = nowIso();
      db.prepare(
        `INSERT INTO locations (
          id, name, address, enabled, created_at, updated_at, arrival_instructions, latitude, longitude
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.name.trim(),
        input.address.trim(),
        input.enabled === false ? 0 : 1,
        stamp,
        stamp,
        input.arrivalInstructions?.trim() ?? "",
        input.latitude ?? null,
        input.longitude ?? null,
      );
      return presentLocation(requireLocation(id));
    },

    updateAdminLocation(
      locationId: string,
      input: {
        name?: string;
        address?: string;
        enabled?: boolean;
        arrivalInstructions?: string;
        latitude?: number | null;
        longitude?: number | null;
      },
    ): LocationDto {
      const location = requireLocation(locationId);
      const name = input.name?.trim() ?? location.name;
      const address = input.address?.trim() ?? location.address;
      db.prepare(
        `UPDATE locations
         SET name = ?, address = ?, enabled = ?, arrival_instructions = ?, latitude = ?, longitude = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        name,
        address,
        input.enabled === undefined ? location.enabled : input.enabled ? 1 : 0,
        input.arrivalInstructions === undefined ? location.arrival_instructions : input.arrivalInstructions.trim(),
        input.latitude === undefined ? location.latitude : input.latitude,
        input.longitude === undefined ? location.longitude : input.longitude,
        nowIso(),
        locationId,
      );
      db.prepare(`UPDATE slots SET location = ?, address = ? WHERE location_id = ?`).run(name, address, locationId);
      db.prepare(`UPDATE course_runs SET location = ?, address = ? WHERE location_id = ?`).run(name, address, locationId);
      return presentLocation(requireLocation(locationId));
    },

    createAdminSlot(input: {
      locationId: string;
      startsAt: string;
      durationMinutes: number;
      capacity: number;
      pricePence: number;
      title: string;
      instructor: string;
      blurb: string;
    }): SlotDto {
      assertLessonDuration(input.durationMinutes);
      assertPartyCapacity(input.capacity);
      const place = requireLocation(input.locationId);
      const starts = parseInstant(input.startsAt);
      if (!starts) throw new AppError(400, "VALIDATION", "Enter a valid start time.");
      const id = randomUUID();
      db.prepare(
        `INSERT INTO slots (
          id, rule_id, location_id, starts_at, ends_at, duration_minutes, capacity, price_pence,
          title, level, blurb, location, address, instructor, enabled, cancelled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      ).run(
        id,
        `oneoff-${id}`,
        place.id,
        toUtcIso(starts),
        toUtcIso(starts.plus({ minutes: input.durationMinutes })),
        input.durationMinutes,
        input.capacity,
        input.pricePence,
        input.title,
        "",
        input.blurb,
        place.name,
        place.address,
        input.instructor,
      );
      return presentSlot(requireSlot(id), 0, clock());
    },

    updateAdminSlot(
      slotId: string,
      input: {
        capacity?: number;
        pricePence?: number;
        title?: string;
        instructor?: string;
        blurb?: string;
        cancelled?: boolean;
      },
    ): SlotDto {
      if (input.capacity !== undefined) assertPartyCapacity(input.capacity);
      const slot = requireSlot(slotId);
      db.prepare(
        `UPDATE slots SET
          capacity = ?, price_pence = ?, title = ?, level = ?, instructor = ?, blurb = ?, cancelled = ?
         WHERE id = ?`,
      ).run(
        input.capacity ?? slot.capacity,
        input.pricePence ?? slot.price_pence,
        input.title ?? slot.title,
        "",
        input.instructor ?? slot.instructor,
        input.blurb ?? slot.blurb,
        input.cancelled === undefined ? slot.cancelled : input.cancelled ? 1 : 0,
        slotId,
      );
      return presentSlot(requireSlot(slotId), countOccupied(slotId, ""), clock());
    },

    listAdminSlots(): SlotDto[] {
      expireStale();
      materializeEnabledRules(db, clock());
      const occupied = occupiedMap();
      const now = clock();
      return getRows<SlotRow>(db, `SELECT * FROM slots ORDER BY starts_at`).map((slot) =>
        presentSlot(slot, occupied.get(slot.id) ?? 0, now),
      );
    },

    listAdminRules(): AvailabilityRuleDto[] {
      materializeEnabledRules(db, clock());
      return getRows<AvailabilityRuleRow>(db, `SELECT * FROM availability_rules ORDER BY weekday, hour, minute`).map(
        (rule) => presentRule(rule, requireLocation(rule.location_id || FAREHAM_LOCATION_ID)),
      );
    },

    createAdminRule(input: RuleInput): AvailabilityRuleDto {
      validateRuleInput(input);
      const rule = upsertRule(db, randomUUID(), { ...input, enabled: input.enabled !== false }, clock());
      return presentRule(rule, requireLocation(rule.location_id));
    },

    updateAdminRule(ruleId: string, input: RuleInput): AvailabilityRuleDto {
      requireRule(ruleId);
      validateRuleInput(input);
      const rule = upsertRule(db, ruleId, input, clock());
      return presentRule(rule, requireLocation(rule.location_id));
    },

    setAdminRuleEnabled(ruleId: string, enabled: boolean): AvailabilityRuleDto {
      const rule = requireRule(ruleId);
      const now = clock();
      db.prepare(`UPDATE availability_rules SET enabled = ?, updated_at = ? WHERE id = ?`).run(
        enabled ? 1 : 0,
        toUtcIso(now),
        ruleId,
      );
      if (enabled) {
        materializeRule(db, requireRule(ruleId), now);
        db.prepare(`UPDATE slots SET enabled = 1 WHERE rule_id = ? AND starts_at > ? AND cancelled = 0`).run(
          ruleId,
          toUtcIso(now),
        );
      } else {
        disableFutureRuleSlots(db, rule.id, now);
      }
      return presentRule(requireRule(ruleId), requireLocation(rule.location_id));
    },

    listAdminCourseProducts(): CourseProductDto[] {
      return getRows<CourseProductRow>(db, `SELECT * FROM course_products ORDER BY days, title`).map((product) =>
        presentCourseProduct(product, requireLocation(product.location_id)),
      );
    },

    createAdminCourseProduct(input: {
      locationId: string;
      days: number;
      capacity: number;
      pricePence: number;
      title: string;
      blurb: string;
      instructor: string;
      enabled?: boolean;
    }): CourseProductDto {
      assertCourseDays(input.days);
      assertPartyCapacity(input.capacity);
      requireLocation(input.locationId);
      const id = randomUUID();
      const stamp = nowIso();
      db.prepare(
        `INSERT INTO course_products (
          id, location_id, days, daily_minutes, capacity, price_pence,
          title, level, blurb, instructor, enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.locationId,
        input.days,
        COURSE_DAILY_MINUTES,
        input.capacity,
        input.pricePence,
        input.title,
        "",
        input.blurb,
        input.instructor,
        input.enabled === false ? 0 : 1,
        stamp,
        stamp,
      );
      const product = getRow<CourseProductRow>(db, `SELECT * FROM course_products WHERE id = ?`, id)!;
      return presentCourseProduct(product, requireLocation(product.location_id));
    },

    updateAdminCourseProduct(
      productId: string,
      input: {
        locationId?: string;
        days?: number;
        capacity?: number;
        pricePence?: number;
        title?: string;
        blurb?: string;
        instructor?: string;
        enabled?: boolean;
      },
    ): CourseProductDto {
      const product = getRow<CourseProductRow>(db, `SELECT * FROM course_products WHERE id = ?`, productId);
      if (!product) throw new AppError(404, "NOT_FOUND", "That course product doesn't exist.");
      if (input.days !== undefined) assertCourseDays(input.days);
      if (input.capacity !== undefined) assertPartyCapacity(input.capacity);
      if (input.locationId) requireLocation(input.locationId);
      db.prepare(
        `UPDATE course_products SET
          location_id = ?, days = ?, capacity = ?, price_pence = ?, title = ?, level = ?, blurb = ?,
          instructor = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        input.locationId ?? product.location_id,
        input.days ?? product.days,
        input.capacity ?? product.capacity,
        input.pricePence ?? product.price_pence,
        input.title ?? product.title,
        "",
        input.blurb ?? product.blurb,
        input.instructor ?? product.instructor,
        input.enabled === undefined ? product.enabled : input.enabled ? 1 : 0,
        nowIso(),
        productId,
      );
      const fresh = getRow<CourseProductRow>(db, `SELECT * FROM course_products WHERE id = ?`, productId)!;
      return presentCourseProduct(fresh, requireLocation(fresh.location_id));
    },

    listAdminCourseRuns(): CourseRunDto[] {
      const occupied = courseOccupiedMap();
      const now = clock();
      return getRows<CourseRunRow>(db, `SELECT * FROM course_runs ORDER BY first_date, daily_hour`).map((run) =>
        presentCourseRun(run, courseSessions(run.id), occupied.get(run.id) ?? 0, now),
      );
    },

    createAdminCourseRun(input: {
      productId: string;
      firstDate: string;
      dailyHour: number;
      dailyMinute: number;
      capacity?: number;
      pricePence?: number;
      enabled?: boolean;
    }): CourseRunDto {
      const product = getRow<CourseProductRow>(db, `SELECT * FROM course_products WHERE id = ?`, input.productId);
      if (!product) throw new AppError(404, "NOT_FOUND", "That course product doesn't exist.");
      assertMorningWindow(input.dailyHour, input.dailyMinute);
      const place = requireLocation(product.location_id);
      const firstDate = DateTime.fromISO(input.firstDate, { zone: ZONE }).startOf("day");
      if (!firstDate.isValid) throw new AppError(400, "VALIDATION", "Enter a valid first date.");
      const id = randomUUID();
      db.prepare(
        `INSERT INTO course_runs (
          id, product_id, location_id, first_date, daily_hour, daily_minute, days, daily_minutes,
          capacity, price_pence, title, level, blurb, instructor, location, address, enabled, cancelled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ).run(
        id,
        product.id,
        product.location_id,
        firstDate.toFormat("yyyy-MM-dd"),
        input.dailyHour,
        input.dailyMinute,
        product.days,
        product.daily_minutes,
        input.capacity ?? product.capacity,
        input.pricePence ?? product.price_pence,
        product.title,
        "",
        product.blurb,
        product.instructor,
        place.name,
        place.address,
        input.enabled === false ? 0 : 1,
        nowIso(),
      );
      materializeCourseRun(db, id);
      const run = requireCourseRun(id);
      return presentCourseRun(run, courseSessions(run.id), 0, clock());
    },

    updateAdminCourseRun(
      runId: string,
      input: { cancelled?: boolean; enabled?: boolean; capacity?: number; pricePence?: number },
    ): CourseRunDto {
      if (input.capacity !== undefined) assertPartyCapacity(input.capacity);
      const run = requireCourseRun(runId);
      db.prepare(
        `UPDATE course_runs SET
          cancelled = ?, enabled = ?, capacity = ?, price_pence = ?
         WHERE id = ?`,
      ).run(
        input.cancelled === undefined ? run.cancelled : input.cancelled ? 1 : 0,
        input.enabled === undefined ? run.enabled : input.enabled ? 1 : 0,
        input.capacity ?? run.capacity,
        input.pricePence ?? run.price_pence,
        runId,
      );
      const fresh = requireCourseRun(runId);
      return presentCourseRun(fresh, courseSessions(fresh.id), countCourseOccupied(fresh.id, ""), clock());
    },

    courseSuggestions(userId: string, input: { days: number; locationId?: string; partySize?: number }) {
      requireUser(userId);
      expireStale();
      assertCourseDays(input.days);
      if (input.partySize !== undefined && input.partySize !== 1 && input.partySize !== 2) {
        throw new AppError(400, "VALIDATION", "Choose 1-to-1 or 1-to-2.");
      }
      const location = input.locationId ? requireLocation(input.locationId) : defaultLocation();
      return suggestCrashCourses(db, clock(), { locationId: location.id, days: input.days as CourseLength });
    },

    courseDayOptions(userId: string, input: { locationId?: string; excludeDateKeys?: string[] }) {
      requireUser(userId);
      expireStale();
      const location = input.locationId ? requireLocation(input.locationId) : defaultLocation();
      return {
        locationId: location.id,
        sessions: listCourseDayOptions(db, clock(), { locationId: location.id, excludeDateKeys: input.excludeDateKeys }),
      };
    },

    addCourseToBasket(
      userId: string,
      input: { days: number; locationId?: string; partySize?: number; sessions: SessionChoice[]; goal?: string; comments?: string },
    ) {
      const user = requireUser(userId);
      expireStale();
      assertCourseDays(input.days);
      const party = input.partySize ?? 1;
      if (party !== 1 && party !== 2) throw new AppError(400, "VALIDATION", "Choose 1-to-1 or 1-to-2.");
      const location = input.locationId ? requireLocation(input.locationId) : defaultLocation();
      if (!location.enabled) throw new AppError(409, "SLOT_UNAVAILABLE", "This pool isn't taking bookings.");
      const product = getRow<{ id: string; blurb: string; instructor: string }>(
        db,
        `SELECT id, blurb, instructor FROM course_products WHERE days = ? AND enabled = 1 ORDER BY id LIMIT 1`,
        input.days,
      );
      if (!product) throw new AppError(409, "COURSE_UNAVAILABLE", "Crash courses aren't set up yet.");
      const price = COURSE_PACKAGE_PRICES[input.days as CourseLength];
      const goal = input.goal?.trim() ?? "";
      const comments = input.comments?.trim() ?? "";
      const resolved = assertCourseSessions(db, clock(), {
        locationId: location.id,
        days: input.days,
        sessions: input.sessions,
      });
      withTransaction(db, () => {
        const again = assertCourseSessions(db, clock(), {
          locationId: location.id,
          days: input.days,
          sessions: input.sessions,
        });
        const runId = randomUUID();
        const stamp = nowIso();
        const first = again[0]!;
        db.prepare(
          `INSERT INTO course_runs (
            id, product_id, location_id, first_date, daily_hour, daily_minute, days, daily_minutes,
            capacity, price_pence, title, level, blurb, instructor, location, address, enabled, cancelled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 1, 0, ?)`,
        ).run(
          runId,
          product.id,
          location.id,
          first.dateKey,
          first.hour,
          first.minute,
          input.days,
          COURSE_DAILY_MINUTES,
          party,
          price,
          `${input.days}-day crash course`,
          product.blurb,
          product.instructor,
          location.name,
          location.address,
          stamp,
        );
        const insertSession = db.prepare(
          `INSERT INTO course_sessions (id, run_id, day_index, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)`,
        );
        again.forEach((session, index) => {
          insertSession.run(randomUUID(), runId, index + 1, session.startsAt, session.endsAt);
        });
        const plan = coursePaymentPlan(price, fromIso(again[0]!.startsAt), clock());
        db.prepare(
          `INSERT INTO bookings (
            id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
            stripe_session_id, stripe_payment_intent, payment_source, return_url,
            calendar_event_id, created_at, confirmed_at, rescheduled_at,
            deposit_pence, balance_pence, balance_due_at, balance_status, course_goal, course_comments
          ) VALUES (?, ?, ?, 'course', NULL, ?, 'pending_payment', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          makeReference(db),
          user.id,
          runId,
          toUtcIso(clock().plus({ milliseconds: HOLD_MS })),
          price,
          stamp,
          plan.depositPence,
          plan.balancePence,
          plan.dueAt ? toUtcIso(plan.dueAt) : null,
          plan.fullUpfront ? "not_required" : "scheduled",
          goal,
          comments,
        );
      });
      return this.basket(userId);
    },

    async rescheduleCourseSession(
      userId: string,
      bookingId: string,
      sessionId: string,
      choice: SessionChoice,
    ): Promise<MutationResult> {
      requireUser(userId);
      const booking = requireOwned(userId, bookingId);
      if (booking.kind !== "course" || !booking.course_run_id) {
        throw new AppError(400, "VALIDATION", "This booking isn't a crash course.");
      }
      if (booking.status !== "confirmed") {
        throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before moving this course.");
      }
      const run = requireCourseRun(booking.course_run_id);
      const current = courseSessions(run.id).find((session) => session.id === sessionId);
      if (!current) throw new AppError(404, "NOT_FOUND", "That course day doesn't exist.");
      const decision = getRescheduleBlock(fromIso(current.starts_at), clock());
      if (!decision.ok) throw new AppError(409, decision.code, decision.message);
      const others = courseSessions(run.id).filter((session) => session.id !== sessionId);
      if (others.some((session) => fromIso(session.starts_at).setZone(ZONE).toFormat("yyyy-MM-dd") === choice.dateKey)) {
        throw new AppError(400, "VALIDATION", "Each day of the course has to be a different date.");
      }
      const next = assertSessionOpen(db, clock(), run.location_id, choice, booking.id);
      if (others.some((session) => overlapsSession(session.starts_at, session.ends_at, next.startsAt, next.endsAt))) {
        throw new AppError(409, "SLOT_OVERLAP", "That time overlaps another day of this course.");
      }
      if (next.startsAt === current.starts_at) throw new AppError(400, "VALIDATION", "Choose a different day.");

      withTransaction(db, () => {
        const again = requireOwned(userId, bookingId);
        if (again.status !== "confirmed" || again.course_run_id !== run.id) {
          throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before moving this course.");
        }
        const currentAgain = courseSessions(run.id).find((session) => session.id === sessionId);
        if (!currentAgain) throw new AppError(404, "NOT_FOUND", "That course day doesn't exist.");
        const decisionAgain = getRescheduleBlock(fromIso(currentAgain.starts_at), clock());
        if (!decisionAgain.ok) throw new AppError(409, decisionAgain.code, decisionAgain.message);
        const moved = assertSessionOpen(db, clock(), run.location_id, choice, again.id);
        const siblings = courseSessions(run.id).filter((session) => session.id !== sessionId);
        if (siblings.some((session) => fromIso(session.starts_at).setZone(ZONE).toFormat("yyyy-MM-dd") === choice.dateKey)) {
          throw new AppError(400, "VALIDATION", "Each day of the course has to be a different date.");
        }
        if (siblings.some((session) => overlapsSession(session.starts_at, session.ends_at, moved.startsAt, moved.endsAt))) {
          throw new AppError(409, "SLOT_OVERLAP", "That time overlaps another day of this course.");
        }
        db.prepare(`UPDATE course_sessions SET starts_at = ?, ends_at = ? WHERE id = ?`).run(moved.startsAt, moved.endsAt, sessionId);
        renumberCourseSessions(run.id);
        const stamp = nowIso();
        db.prepare(`UPDATE bookings SET rescheduled_at = ? WHERE id = ?`).run(stamp, again.id);
        db.prepare(
          `INSERT INTO booking_events (id, booking_id, type, from_course_run_id, to_course_run_id, created_at)
           VALUES (?, ?, 'rescheduled', ?, ?, ?)`,
        ).run(randomUUID(), again.id, run.id, run.id, stamp);
      });

      const movedBooking = requireOwned(userId, bookingId);
      const calendarSyncError = await syncCalendar(movedBooking);
      return { booking: toBookingDto(requireOwned(userId, bookingId)), calendarSyncError, returnUrl: movedBooking.return_url };
    },

    basket(userId: string) {
      requireUser(userId);
      expireStale();
      const rows = getRows<BookingRow>(
        db,
        `SELECT * FROM bookings
         WHERE user_id = ? AND status = 'pending_payment' AND hold_expires_at > ?
           AND kind IN ('lesson', 'course')
         ORDER BY created_at`,
        userId,
        nowIso(),
      );
      const items = rows.map((row) => toBookingDto(row));
      const totalPence = items.reduce((sum, item) => sum + item.payTodayPence, 0);
      return { items, totalPence, totalLabel: formatGBP(totalPence) };
    },

    addToBasket(userId: string, slotId: string) {
      const user = requireUser(userId);
      expireStale();
      const existing = getRow<BookingRow>(
        db,
        `SELECT * FROM bookings WHERE user_id = ? AND slot_id = ? AND status = 'pending_payment' AND hold_expires_at > ?`,
        user.id,
        slotId,
        nowIso(),
      );
      if (existing) return this.basket(userId);
      const slot = parseOfferId(slotId) ? materializeOffer(db, clock(), slotId) : requireSlot(slotId);
      assertSlotBookable(slot);
      const block = getBookingBlock(fromIso(slot.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);
      assertStoredSlotOpen(db, clock(), slot);
      const price = lessonPricePence(db, slot.duration_minutes, nowIso());
      const holdUntil = toUtcIso(clock().plus({ milliseconds: HOLD_MS }));
      const id = randomUUID();
      const stamp = nowIso();
      try {
        db.prepare(
          `INSERT INTO bookings (
            id, reference, user_id, kind, slot_id, course_run_id, status, hold_expires_at, price_pence,
            stripe_session_id, stripe_payment_intent, payment_source, return_url,
            calendar_event_id, created_at, confirmed_at, rescheduled_at
          ) VALUES (?, ?, ?, 'lesson', ?, NULL, 'pending_payment', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL)`,
        ).run(id, makeReference(db), user.id, slot.id, holdUntil, price, stamp);
      } catch (error) {
        if (isUniqueError(error)) throw new AppError(409, "ALREADY_BOOKED", "That lesson is already in your basket.");
        throw error;
      }
      return this.basket(userId);
    },

    removeFromBasket(userId: string, slotId: string) {
      requireUser(userId);
      db.prepare(
        `UPDATE bookings SET status = 'expired'
         WHERE user_id = ? AND slot_id = ? AND status = 'pending_payment'`,
      ).run(userId, slotId);
      return this.basket(userId);
    },

    removeBasketBooking(userId: string, bookingId: string) {
      const booking = requireOwned(userId, bookingId);
      if (booking.status === "pending_payment") {
        db.prepare(`UPDATE bookings SET status = 'expired' WHERE id = ?`).run(booking.id);
      }
      return this.basket(userId);
    },

    async checkoutBasket(
      userId: string,
      returnUrl: string,
      options?: { savedCardId?: string; saveCard?: boolean },
    ): Promise<CheckoutResult> {
      const user = requireUser(userId);
      assertReturnUrl(returnUrl);
      expireStale();
      const rows = getRows<BookingRow>(
        db,
        `SELECT * FROM bookings
         WHERE user_id = ? AND status = 'pending_payment' AND hold_expires_at > ?
           AND kind IN ('lesson', 'course')
         ORDER BY created_at`,
        userId,
        nowIso(),
      );
      if (rows.length === 0) throw new AppError(400, "VALIDATION", "Your basket is empty.");
      assertProfileReady(userId);
      for (const row of rows) {
        if (row.kind === "course" && !(row.course_goal ?? "").trim()) {
          throw new AppError(400, "COURSE_GOAL_REQUIRED", "Tell us what you would like to achieve on the crash course.");
        }
      }
      const holdUntil = toUtcIso(clock().plus({ milliseconds: HOLD_MS }));
      for (const row of rows) {
        if (row.kind === "course" && row.course_run_id) {
          const run = requireCourseRun(row.course_run_id);
          const sessions = courseSessions(run.id).map((session) => {
            const local = fromIso(session.starts_at).setZone(ZONE);
            return { dateKey: local.toFormat("yyyy-MM-dd"), hour: local.hour, minute: local.minute };
          });
          assertCourseSessions(db, clock(), {
            locationId: run.location_id,
            days: run.days,
            sessions,
            exceptBookingId: row.id,
          });
          db.prepare(`UPDATE bookings SET return_url = ?, hold_expires_at = ? WHERE id = ?`).run(returnUrl, holdUntil, row.id);
          continue;
        }
        const slot = requireSlot(row.slot_id!);
        assertSlotBookable(slot);
        const block = getBookingBlock(fromIso(slot.starts_at), clock());
        if (!block.ok) throw new AppError(400, block.code, block.message);
        assertStoredSlotOpen(db, clock(), slot, row.id);
        const price = lessonPricePence(db, slot.duration_minutes, nowIso());
        db.prepare(`UPDATE bookings SET price_pence = ?, return_url = ?, hold_expires_at = ? WHERE id = ?`).run(
          price,
          returnUrl,
          holdUntil,
          row.id,
        );
      }
      const fresh = rows.map((row) => getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, row.id)!);
      const lines = fresh.map((row) => {
        const presented = toBookingDto(row);
        if (row.kind === "course" && presented.course) {
          const dueNow = presented.payTodayPence || row.price_pence;
          return {
            title: presented.balancePence > 0 ? `${presented.course.title} deposit` : presented.course.title,
            description: presented.course.sessions.map((session) => `${session.dayLabel} ${session.timeLabel}`).join("; "),
            amountPence: dueNow,
          };
        }
        return {
          title: `${presented.slot?.durationMinutes ?? ""} min lesson`,
          description: `${presented.slot?.dayLabel ?? ""} ${presented.slot?.startTimeLabel ?? ""} · ${presented.slot?.partyLabel ?? ""}`,
          amountPence: row.price_pence,
        };
      });
      const total = lines.reduce((sum, line) => sum + line.amountPence, 0);
      if (options?.savedCardId) {
        const card = getRow<CardRow>(
          db,
          `SELECT * FROM payment_cards WHERE id = ? AND user_id = ?`,
          options.savedCardId,
          userId,
        );
        if (!card) throw new AppError(404, "NOT_FOUND", "That saved card doesn't exist.");
        const charged = await payments.chargeOffSession({
          customerId: card.stripe_customer_id,
          paymentMethodId: card.stripe_payment_method_id,
          amountPence: total,
          bookingId: fresh[0]!.id,
          description: lines.map((line) => line.title).join(", "),
        });
        if (!charged.ok) throw new AppError(402, "CARD_DECLINED", charged.message);
        const stamp = nowIso();
        for (const row of fresh) {
          db.prepare(
            `UPDATE bookings
             SET status = 'confirmed', confirmed_at = ?, payment_source = ?, stripe_payment_intent = ?,
                 stripe_customer_id = ?, stripe_payment_method_id = ?
             WHERE id = ? AND status != 'confirmed'`,
          ).run(stamp, payments.mode, charged.paymentIntentId, card.stripe_customer_id, card.stripe_payment_method_id, row.id);
        }
        const booking = toBookingDto(getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, fresh[0]!.id)!);
        return { booking, checkoutUrl: returnUrl, sessionId: charged.paymentIntentId, paidImmediately: true };
      }
      const saveCard = Boolean(options?.saveCard) || fresh.some((row) => (row.balance_pence ?? 0) > 0 && row.balance_status === "scheduled");
      const session = await payments.createCheckout({
        bookingId: fresh[0]!.id,
        amountPence: total,
        title: fresh.length === 1 ? lines[0]!.title : `${fresh.length} bookings`,
        description: lines.map((line) => line.description).join("; "),
        customerEmail: user.email,
        reference: fresh.map((row) => row.reference).join(", "),
        lines,
        saveCard,
        purpose: "booking",
      });
      for (const row of fresh) {
        db.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE id = ?`).run(session.id, row.id);
      }
      const booking = toBookingDto(getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, fresh[0]!.id)!);
      return { booking, checkoutUrl: session.url, sessionId: session.id };
    },

    listAdminWindows(): WindowRow[] {
      return listWindows(db);
    },

    saveAdminWindow(input: {
      id?: string;
      locationId: string;
      weekday: number;
      startHour: number;
      startMinute: number;
      endHour: number;
      endMinute: number;
    }) {
      requireLocation(input.locationId);
      return upsertWindow(db, input.id ?? randomUUID(), input, nowIso());
    },

    setAdminWindowEnabled(id: string, enabled: boolean) {
      const window = getRow<WindowRow>(db, `SELECT * FROM availability_windows WHERE id = ?`, id);
      if (!window) throw new AppError(404, "NOT_FOUND", "That availability window doesn't exist.");
      db.prepare(`UPDATE availability_windows SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, nowIso(), id);
      return getRow<WindowRow>(db, `SELECT * FROM availability_windows WHERE id = ?`, id)!;
    },

    listAdminLessonRates() {
      return listLessonRates(db, nowIso());
    },

    saveAdminLessonRates(prices: { durationMinutes: number; pricePence: number }[]) {
      for (const price of prices) setLessonRate(db, price.durationMinutes, price.pricePence, nowIso());
      return listLessonRates(db, nowIso());
    },

    listAdminBookingNotes(): { reference: string; status: string; when: string; priceLabel: string }[] {
      return getRows<BookingRow>(
        db,
        `SELECT * FROM bookings WHERE kind = 'lesson' AND status IN ('confirmed', 'cancelled') ORDER BY created_at DESC LIMIT 40`,
      ).map((row) => ({
        reference: row.reference,
        status: row.status,
        when: row.slot_id ? (getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, row.slot_id)?.starts_at ?? "") : "",
        priceLabel: formatGBP(row.price_pence),
      }));
    },
  };
}

function overlapsSession(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const start = fromIso(bStart).toMillis();
  const end = fromIso(bEnd).toMillis();
  return start < fromIso(aEnd).toMillis() && end > fromIso(aStart).toMillis();
}

function assertPartyCapacity(capacity: number) {
  if (capacity !== 1 && capacity !== 2) {
    throw new AppError(400, "VALIDATION", "Sessions are 1-to-1 or 1-to-2 only.");
  }
}

function validateRuleInput(input: RuleInput) {
  assertLessonDuration(input.durationMinutes);
  assertPartyCapacity(input.capacity);
  if (input.weekday < 1 || input.weekday > 7) {
    throw new AppError(400, "VALIDATION", "Choose a day of the week.");
  }
  if (input.hour < 0 || input.hour > 23 || input.minute < 0 || input.minute > 59) {
    throw new AppError(400, "VALIDATION", "Enter a valid start time.");
  }
}

type MockPaymentsPeek = {
  peekToken(token: string): { sessionId: string; bookingId: string; paid: boolean };
};

function makeReference(db: DatabaseSync): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bytes = randomBytes(6);
    let code = "LD-";
    for (const byte of bytes) code += alphabet[byte % alphabet.length]!;
    if (!getRow<{ id: string }>(db, `SELECT id FROM bookings WHERE reference = ?`, code)) return code;
  }
  throw new AppError(500, "INTERNAL", "Couldn't allocate a booking reference.");
}

export type LidoService = ReturnType<typeof createService>;
