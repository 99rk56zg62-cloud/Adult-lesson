import { randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { DateTime } from "luxon";
import { hashPassword, readOAuthState, signAccessToken, signOAuthState, verifyPassword } from "./auth.js";
import type { CalendarGateway } from "./calendar.js";
import type { AppConfig } from "./config.js";
import { getRow, getRows, isUniqueError, withTransaction } from "./db.js";
import { AppError } from "./errors.js";
import { presentBooking, presentSlot } from "./format.js";
import type { PaymentProvider } from "./payments.js";
import { isAllowedReturnUrl } from "./return-url.js";
import { getBookingBlock, getRescheduleBlock, HOLD_MS, lastBookableDay, MAX_ADVANCE_WEEKS } from "./rules.js";
import { DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD } from "./seed.js";
import { fromIso, parseInstant, toUtcIso, ZONE } from "./time.js";
import type { BookingDto, BookingRow, PublicConfig, SlotDto, SlotRow, UserDto, UserRow } from "./types.js";

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
};

export type MutationResult = {
  booking: BookingDto;
  calendarSyncError: string | null;
  returnUrl: string | null;
};

const CALENDAR_SYNC_WARNING =
  "The lesson is booked, but Google Calendar couldn't be updated. Try syncing again from the booking.";

const SLOT_TAKEN_MESSAGE =
  "Payment was received, but the session filled after the hold expired, so the booking was not confirmed. If you paid by card, refund the payment in the Stripe dashboard and book another session.";

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

  function requireUser(userId: string): UserRow {
    const user = getRow<UserRow>(db, `SELECT * FROM users WHERE id = ?`, userId);
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Sign in to continue.");
    return user;
  }

  function requireSlot(slotId: string): SlotRow {
    const slot = getRow<SlotRow>(db, `SELECT * FROM slots WHERE id = ?`, slotId);
    if (!slot) throw new AppError(404, "NOT_FOUND", "That session doesn't exist.");
    return slot;
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
       WHERE status = 'confirmed'
          OR (status = 'pending_payment' AND hold_expires_at > ?)
       GROUP BY slot_id`,
      nowIso(),
    );
    return new Map(rows.map((row) => [row.slot_id, Number(row.n)]));
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

  function toBookingDto(booking: BookingRow): BookingDto {
    const slot = requireSlot(booking.slot_id);
    const occupied = countOccupied(slot.id, "");
    return presentBooking(booking, slot, occupied, clock());
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
    const slot = requireSlot(booking.slot_id);
    const user = requireUser(booking.user_id);
    const when = presentSlot(slot, 0, clock());
    try {
      const session = await payments.createCheckout({
        bookingId: booking.id,
        amountPence: booking.price_pence,
        title: `Adult swimming lesson — ${slot.title}`,
        description: `${slot.level} · ${slot.location} · ${when.dayLabel} ${when.timeLabel}`,
        customerEmail: user.email,
        reference: booking.reference,
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

  async function syncCalendar(booking: BookingRow, slot: SlotRow): Promise<string | null> {
    const user = requireUser(booking.user_id);
    if (!user.google_refresh_token) return null;
    try {
      const result = await calendar.upsertEvent({
        refreshToken: user.google_refresh_token,
        eventId: booking.calendar_event_id,
        summary: `Swimming lesson — ${slot.title}`,
        description: `Lido booking ${booking.reference}. Adult swimming lesson (${slot.level}) with ${slot.instructor}.`,
        location: `${slot.location}, ${slot.address}`,
        startsAt: fromIso(slot.starts_at),
        endsAt: fromIso(slot.ends_at),
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
        demoLogin: config.exposeDemoLogin
          ? { email: DEMO_EMAIL, password: DEMO_PASSWORD, name: DEMO_NAME }
          : null,
      };
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

    listSlots(userId: string) {
      requireUser(userId);
      expireStale();
      const now = clock();
      const occupied = occupiedMap();
      const rows = getRows<SlotRow>(db, `SELECT * FROM slots WHERE starts_at > ? ORDER BY starts_at`, nowIso());
      const slots = rows
        .map((slot) => presentSlot(slot, occupied.get(slot.id) ?? 0, now))
        .filter((slot) => getBookingBlock(fromIso(slot.startsAt), now).ok);
      const ends = lastBookableDay(now);
      return {
        timezone: ZONE,
        maxAdvanceWeeks: MAX_ADVANCE_WEEKS,
        rescheduleCutoffHours: 24,
        windowEndsOn: ends.toFormat("yyyy-MM-dd"),
        windowEndsLabel: ends.toFormat("d LLLL yyyy"),
        slots,
      };
    },

    getSlot(userId: string, slotId: string): SlotDto {
      requireUser(userId);
      expireStale();
      const slot = requireSlot(slotId);
      return presentSlot(slot, countOccupied(slot.id, ""), clock());
    },

    async createBooking(userId: string, input: { slotId: string; returnUrl: string }): Promise<CheckoutResult> {
      const user = requireUser(userId);
      assertReturnUrl(input.returnUrl);
      expireStale();
      const slot = requireSlot(input.slotId);
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
              id, reference, user_id, slot_id, status, hold_expires_at, price_pence,
              stripe_session_id, stripe_payment_intent, payment_source, return_url,
              calendar_event_id, created_at, confirmed_at, rescheduled_at
            ) VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, NULL, NULL, NULL, ?, NULL, ?, NULL, NULL)`,
          ).run(id, makeReference(db), user.id, slot.id, holdUntil, slot.price_pence, input.returnUrl, stamp);
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

    async refreshCheckout(userId: string, bookingId: string, returnUrl: string): Promise<CheckoutResult> {
      requireUser(userId);
      assertReturnUrl(returnUrl);
      expireStale();
      const booking = requireOwned(userId, bookingId);
      if (booking.status === "confirmed") {
        throw new AppError(409, "ALREADY_BOOKED", "This lesson is already paid.");
      }
      if (booking.status !== "pending_payment") {
        throw new AppError(409, "HOLD_EXPIRED", "The hold expired. Book the session again.");
      }
      const slot = requireSlot(booking.slot_id);
      const block = getBookingBlock(fromIso(slot.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);
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

      const bookingId = withTransaction(db, () => {
        expireStale();
        const booking = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, verified.bookingId!);
        if (!booking) throw new AppError(404, "NOT_FOUND", "That booking doesn't exist.");
        if (booking.status === "confirmed") return booking.id;
        if (booking.status !== "pending_payment" && booking.status !== "expired") {
          throw new AppError(409, "BOOKING_CLOSED", "This booking can no longer be confirmed.");
        }
        const slot = requireSlot(booking.slot_id);
        if (booking.status !== "pending_payment") {
          if (countOccupied(slot.id, booking.id) >= slot.capacity) {
            throw new AppError(409, "SLOT_TAKEN", SLOT_TAKEN_MESSAGE);
          }
        }
        const source = payments.mode === "stripe" ? "stripe" : "mock";
        db.prepare(
          `UPDATE bookings
           SET status = 'confirmed', confirmed_at = ?, stripe_session_id = ?, stripe_payment_intent = ?, payment_source = ?
           WHERE id = ?`,
        ).run(nowIso(), sessionId, verified.paymentIntentId, source, booking.id);
        return booking.id;
      });

      const booking = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, bookingId)!;
      const slot = requireSlot(booking.slot_id);
      const calendarSyncError = await syncCalendar(booking, slot);
      const fresh = getRow<BookingRow>(db, `SELECT * FROM bookings WHERE id = ?`, bookingId)!;
      return { booking: toBookingDto(fresh), calendarSyncError, returnUrl: fresh.return_url };
    },

    listBookings(userId: string): BookingDto[] {
      requireUser(userId);
      expireStale();
      const rows = getRows<BookingRow>(
        db,
        `SELECT * FROM bookings WHERE user_id = ? AND status IN ('pending_payment', 'confirmed')`,
        userId,
      );
      return rows.map((row) => toBookingDto(row)).sort((a, b) => a.slot.startsAt.localeCompare(b.slot.startsAt));
    },

    getBooking(userId: string, bookingId: string): BookingDto {
      requireUser(userId);
      expireStale();
      return toBookingDto(requireOwned(userId, bookingId));
    },

    async reschedule(userId: string, bookingId: string, slotId: string): Promise<MutationResult> {
      requireUser(userId);
      const booking = requireOwned(userId, bookingId);
      if (booking.status !== "confirmed") {
        throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before rearranging this lesson.");
      }
      const current = requireSlot(booking.slot_id);
      const decision = getRescheduleBlock(fromIso(current.starts_at), clock());
      if (!decision.ok) throw new AppError(409, decision.code, decision.message);
      if (slotId === current.id) throw new AppError(400, "VALIDATION", "Choose a different session.");
      const next = requireSlot(slotId);
      const block = getBookingBlock(fromIso(next.starts_at), clock());
      if (!block.ok) throw new AppError(400, block.code, block.message);

      withTransaction(db, () => {
        expireStale();
        const again = requireOwned(userId, bookingId);
        if (again.status !== "confirmed") {
          throw new AppError(409, "RESCHEDULE_NOT_CONFIRMED", "Finish payment before rearranging this lesson.");
        }
        const currentAgain = requireSlot(again.slot_id);
        const decisionAgain = getRescheduleBlock(fromIso(currentAgain.starts_at), clock());
        if (!decisionAgain.ok) throw new AppError(409, decisionAgain.code, decisionAgain.message);
        const nextAgain = requireSlot(slotId);
        const nextBlock = getBookingBlock(fromIso(nextAgain.starts_at), clock());
        if (!nextBlock.ok) throw new AppError(400, nextBlock.code, nextBlock.message);
        if (countOccupied(nextAgain.id, again.id) >= nextAgain.capacity) {
          throw new AppError(409, "SLOT_FULL", "That session is full.");
        }
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
      const slot = requireSlot(moved.slot_id);
      const calendarSyncError = await syncCalendar(moved, slot);
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
        throw new AppError(409, "PAYMENT_REQUIRED", "Finish payment before adding this lesson to your calendar.");
      }
      const slot = requireSlot(booking.slot_id);
      const error = await syncCalendar(booking, slot);
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
            message: "Google didn't return a refresh token. Remove Lido's access in your Google Account permissions and try again.",
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
      const slot = requireSlot(booking.slot_id);
      const presented = presentSlot(slot, 0, clock());
      return {
        token,
        sessionId: peeked.sessionId,
        reference: booking.reference,
        title: slot.title,
        dayLabel: presented.dayLabel,
        timeLabel: presented.timeLabel,
        location: slot.location,
        priceLabel: presentBooking(booking, slot, 0, clock()).priceLabel,
        alreadyPaid: peeked.paid || booking.status === "confirmed",
      };
    },

    createAdminSlot(input: {
      startsAt: string;
      durationMinutes: number;
      capacity: number;
      pricePence: number;
      title: string;
      level: string;
      location: string;
      address: string;
      instructor: string;
      blurb: string;
    }): SlotDto {
      const starts = parseInstant(input.startsAt);
      if (!starts) throw new AppError(400, "VALIDATION", "Enter a valid start time.");
      const id = randomUUID();
      db.prepare(
        `INSERT INTO slots (
          id, rule_id, starts_at, ends_at, capacity, price_pence, title, level, blurb, location, address, instructor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        `admin-${id}`,
        toUtcIso(starts),
        toUtcIso(starts.plus({ minutes: input.durationMinutes })),
        input.capacity,
        input.pricePence,
        input.title,
        input.level,
        input.blurb,
        input.location,
        input.address,
        input.instructor,
      );
      return presentSlot(requireSlot(id), 0, clock());
    },

    listAdminSlots(): SlotDto[] {
      expireStale();
      const occupied = occupiedMap();
      const now = clock();
      return getRows<SlotRow>(db, `SELECT * FROM slots ORDER BY starts_at`).map((slot) =>
        presentSlot(slot, occupied.get(slot.id) ?? 0, now),
      );
    },
  };
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
