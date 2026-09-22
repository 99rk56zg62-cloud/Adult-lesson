import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { z } from "zod";
import { DateTime } from "luxon";
import type { DatabaseSync } from "node:sqlite";
import {
  adminAvailabilityPage,
  adminDisabledPage,
  adminLoginPage,
  adminOverviewPage,
  adminSessionsPage,
} from "./admin-pages.js";
import { readAccessToken } from "./auth.js";
import type { CalendarGateway } from "./calendar.js";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { infoPage, mockCheckoutPage, redirectPage } from "./pages.js";
import { isMockPayments, type PaymentProvider, type WebhookVerifier } from "./payments.js";
import { appendQuery, isAllowedReturnUrl } from "./return-url.js";
import { createService, type LidoService } from "./service.js";
import { ZONE } from "./time.js";

export type AppDeps = {
  db: DatabaseSync;
  config: AppConfig;
  payments: PaymentProvider;
  calendar: CalendarGateway;
  clock?: () => DateTime;
  verifyWebhook?: WebhookVerifier;
};

const ADMIN_COOKIE = "lido_admin";

const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80, "Name is too long."),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  password: z.string().min(8, "Use at least 8 characters.").max(72, "Use at most 72 characters."),
});

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const returnSchema = z.object({
  returnUrl: z.string().min(8, "Missing return address.").max(2000),
});

const createBookingSchema = returnSchema.extend({
  slotId: z.string().min(1, "Choose a session."),
});

const rescheduleSchema = z.object({
  slotId: z.string().min(1, "Choose a session."),
});

const confirmSchema = z.object({
  sessionId: z.string().min(4, "Missing payment session."),
});

const levelSchema = z.enum(["Beginners", "Improvers", "Confidence", "Technique"]);

const adminSlotSchema = z.object({
  startsAt: z.string().min(10, "Enter a start time."),
  durationMinutes: z.number().int().min(15).max(180),
  capacity: z.number().int().min(1).max(50),
  pricePence: z.number().int().min(50).max(100_000),
  title: z.string().trim().min(2).max(80),
  level: levelSchema,
  location: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(120),
  instructor: z.string().trim().min(2).max(80),
  blurb: z.string().trim().min(2).max(400),
});

const adminRuleSchema = z.object({
  weekday: z.number().int().min(1).max(7),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  durationMinutes: z.number().int().min(15).max(180),
  capacity: z.number().int().min(1).max(50),
  pricePence: z.number().int().min(50).max(100_000),
  title: z.string().trim().min(2).max(80),
  level: levelSchema,
  location: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(120),
  instructor: z.string().trim().min(2).max(80),
  blurb: z.string().trim().min(2).max(400),
  enabled: z.boolean().optional(),
});

function sendError(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

function route(fn: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function queryValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function field(body: any, name: string): string {
  const value = body?.[name];
  return typeof value === "string" ? value.trim() : "";
}

function poundsToPence(value: string): number {
  const pounds = Number(value);
  if (!Number.isFinite(pounds)) throw new AppError(400, "VALIDATION", "Enter a valid price.");
  return Math.round(pounds * 100);
}

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new AppError(400, "VALIDATION", "Enter a valid start time.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function ruleFromForm(body: any) {
  const time = parseTime(field(body, "time") || "19:00");
  return adminRuleSchema.parse({
    weekday: Number(field(body, "weekday")),
    hour: time.hour,
    minute: time.minute,
    durationMinutes: Number(field(body, "durationMinutes")),
    capacity: Number(field(body, "capacity")),
    pricePence: poundsToPence(field(body, "pricePounds") || "0"),
    title: field(body, "title"),
    level: field(body, "level"),
    location: field(body, "location"),
    address: field(body, "address"),
    instructor: field(body, "instructor"),
    blurb: field(body, "blurb"),
    enabled: true,
  });
}

function oneOffFromForm(body: any) {
  const local = field(body, "startsAtLocal");
  if (!local) throw new AppError(400, "VALIDATION", "Enter a start time.");
  const starts = DateTime.fromISO(local, { zone: ZONE });
  if (!starts.isValid) throw new AppError(400, "VALIDATION", "Enter a valid start time.");
  return adminSlotSchema.parse({
    startsAt: starts.toISO()!,
    durationMinutes: Number(field(body, "durationMinutes")),
    capacity: Number(field(body, "capacity")),
    pricePence: poundsToPence(field(body, "pricePounds") || "0"),
    title: field(body, "title"),
    level: field(body, "level"),
    location: field(body, "location"),
    address: field(body, "address"),
    instructor: field(body, "instructor"),
    blurb: field(body, "blurb"),
  });
}

function sendClientRedirect(res: Response, targetUrl: string, heading: string, message: string) {
  let protocol = "";
  try {
    protocol = new URL(targetUrl).protocol;
  } catch {
    protocol = "";
  }
  if (protocol === "http:" || protocol === "https:") {
    res.redirect(303, targetUrl);
    return;
  }
  res.status(200).type("html").send(redirectPage(targetUrl, heading, message));
}

export function createApp(deps: AppDeps) {
  const service: LidoService = createService({
    db: deps.db,
    clock: deps.clock ?? (() => DateTime.now()),
    config: deps.config,
    payments: deps.payments,
    calendar: deps.calendar,
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());

  app.post(
    "/api/webhooks/stripe",
    express.raw({ type: "application/json" }),
    route(async (req, res) => {
      if (!deps.verifyWebhook) {
        throw new AppError(
          503,
          "STRIPE_WEBHOOK",
          "Set STRIPE_WEBHOOK_SECRET to receive Stripe webhooks. Bookings can still confirm when Stripe redirects back.",
        );
      }
      if (!Buffer.isBuffer(req.body)) {
        throw new AppError(400, "VALIDATION", "Expected a raw JSON body.");
      }
      const event = deps.verifyWebhook(req.body, req.header("stripe-signature") ?? undefined);
      if (event.type === "checkout.session.completed" && event.sessionId) {
        try {
          await service.confirmPaidSession(event.sessionId);
        } catch (error) {
          if (error instanceof AppError && error.code === "SLOT_TAKEN") {
            console.error(error.message);
            res.json({ received: true, warning: error.code });
            return;
          }
          throw error;
        }
      }
      res.json({ received: true });
    }),
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  function requireUser(req: Request, res: Response, next: NextFunction) {
    try {
      const header = req.header("authorization") ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) {
        sendError(res, 401, "UNAUTHORIZED", "Sign in to continue.");
        return;
      }
      res.locals.userId = readAccessToken(token, deps.config.jwtSecret);
      next();
    } catch (error) {
      next(error);
    }
  }

  function userId(res: Response): string {
    return String(res.locals.userId ?? "");
  }

  function requireAdmin(req: Request) {
    if (!deps.config.adminToken) {
      throw new AppError(404, "NOT_FOUND", "Admin API is disabled.");
    }
    const header = req.header("x-admin-token") ?? "";
    if (!tokensMatch(header, deps.config.adminToken)) {
      throw new AppError(401, "UNAUTHORIZED", "Admin token didn't match.");
    }
  }

  function adminAuthed(req: Request): boolean {
    if (!deps.config.adminToken) return false;
    const cookie = readCookie(req, ADMIN_COOKIE) ?? "";
    const header = req.header("x-admin-token") ?? "";
    return tokensMatch(cookie, deps.config.adminToken) || tokensMatch(header, deps.config.adminToken);
  }

  function requireAdminPage(req: Request, res: Response): boolean {
    if (!deps.config.adminToken) {
      res.status(404).type("html").send(adminDisabledPage());
      return false;
    }
    if (!adminAuthed(req)) {
      res.redirect(303, "/admin/login");
      return false;
    }
    return true;
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "lido-api" });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      ...service.publicConfig(),
      adminUrl: deps.config.adminToken ? `${deps.config.apiPublicUrl}/admin` : null,
    });
  });

  app.post(
    "/api/auth/register",
    route(async (req, res) => {
      const body = registerSchema.parse(req.body);
      res.status(201).json(service.register(body));
    }),
  );

  app.post(
    "/api/auth/login",
    route(async (req, res) => {
      const body = loginSchema.parse(req.body);
      res.json(service.login(body));
    }),
  );

  app.get(
    "/api/me",
    requireUser,
    route(async (_req, res) => {
      res.json({ user: service.me(userId(res)) });
    }),
  );

  app.get(
    "/api/slots",
    requireUser,
    route(async (_req, res) => {
      res.json(service.listSlots(userId(res)));
    }),
  );

  app.get(
    "/api/slots/:id",
    requireUser,
    route(async (req, res) => {
      res.json({ slot: service.getSlot(userId(res), param(req.params.id)) });
    }),
  );

  app.post(
    "/api/bookings",
    requireUser,
    route(async (req, res) => {
      const body = createBookingSchema.parse(req.body);
      res.status(201).json(await service.createBooking(userId(res), body));
    }),
  );

  app.get(
    "/api/bookings",
    requireUser,
    route(async (_req, res) => {
      res.json({ bookings: service.listBookings(userId(res)) });
    }),
  );

  app.get(
    "/api/bookings/:id",
    requireUser,
    route(async (req, res) => {
      res.json({ booking: service.getBooking(userId(res), param(req.params.id)) });
    }),
  );

  app.post(
    "/api/bookings/:id/checkout",
    requireUser,
    route(async (req, res) => {
      const body = returnSchema.parse(req.body);
      res.json(await service.refreshCheckout(userId(res), param(req.params.id), body.returnUrl));
    }),
  );

  app.post(
    "/api/bookings/:id/reschedule",
    requireUser,
    route(async (req, res) => {
      const body = rescheduleSchema.parse(req.body);
      const result = await service.reschedule(userId(res), param(req.params.id), body.slotId);
      res.json({ booking: result.booking, calendarSyncError: result.calendarSyncError });
    }),
  );

  app.post(
    "/api/bookings/:id/calendar-sync",
    requireUser,
    route(async (req, res) => {
      res.json({ booking: await service.syncBookingCalendar(userId(res), param(req.params.id)) });
    }),
  );

  app.post(
    "/api/payments/confirm",
    requireUser,
    route(async (req, res) => {
      const body = confirmSchema.parse(req.body);
      const result = await service.confirmPaidSession(body.sessionId, userId(res));
      res.json({ booking: result.booking, calendarSyncError: result.calendarSyncError });
    }),
  );

  app.get(
    "/api/payments/return",
    route(async (req, res) => {
      const sessionId = queryValue(req.query.session_id);
      if (!sessionId) {
        res.status(400).type("html").send(infoPage("Payment not completed", "The return link was missing a payment session."));
        return;
      }
      try {
        const result = await service.confirmPaidSession(sessionId);
        const target =
          result.returnUrl && isAllowedReturnUrl(result.returnUrl, deps.config.appWebUrl)
            ? appendQuery(result.returnUrl, { session_id: sessionId, booking_id: result.booking.id })
            : null;
        if (!target) {
          res.type("html").send(infoPage("You're booked", `Reference ${result.booking.reference}. Return to the Lido app to see the lesson.`));
          return;
        }
        sendClientRedirect(res, target, "You're booked", `Reference ${result.booking.reference}. Taking you back to Lido.`);
      } catch (error) {
        if (error instanceof AppError) {
          res.status(error.status).type("html").send(infoPage("Payment not completed", error.message));
          return;
        }
        throw error;
      }
    }),
  );

  app.get("/api/payments/cancelled", (_req, res) => {
    res
      .type("html")
      .send(
        infoPage(
          "Payment cancelled",
          "No payment was taken. You can close this window and finish the booking from My lessons while the space is still held.",
        ),
      );
  });

  app.get(
    "/api/payments/mock-checkout",
    route(async (req, res) => {
      if (!isMockPayments(deps.payments)) {
        throw new AppError(404, "NOT_FOUND", "Test payments are switched off. This server is using Stripe.");
      }
      const token = queryValue(req.query.token);
      if (!token) throw new AppError(404, "NOT_FOUND", "This test payment link is invalid.");
      res.type("html").send(mockCheckoutPage(service.previewMockCheckout(token)));
    }),
  );

  app.post(
    "/api/payments/mock-complete",
    route(async (req, res) => {
      if (!isMockPayments(deps.payments)) {
        throw new AppError(404, "NOT_FOUND", "Test payments are switched off. This server is using Stripe.");
      }
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const paid = deps.payments.markPaidByToken(token);
      res.redirect(303, `/api/payments/return?session_id=${encodeURIComponent(paid.sessionId)}`);
    }),
  );

  app.get(
    "/api/calendar/status",
    requireUser,
    route(async (_req, res) => {
      res.json(service.calendarStatus(userId(res)));
    }),
  );

  app.post(
    "/api/calendar/connect",
    requireUser,
    route(async (req, res) => {
      const body = returnSchema.parse(req.body);
      res.json({ url: service.calendarAuthUrl(userId(res), body.returnUrl) });
    }),
  );

  app.get(
    "/api/calendar/callback",
    route(async (req, res) => {
      const result = await service.calendarCallback(
        queryValue(req.query.code),
        queryValue(req.query.state),
        queryValue(req.query.error),
      );
      const target = appendQuery(result.returnUrl, {
        calendar: result.ok ? "connected" : "error",
        message: result.message,
      });
      sendClientRedirect(res, target, result.ok ? "Calendar connected" : "Calendar not connected", result.message);
    }),
  );

  app.delete(
    "/api/calendar",
    requireUser,
    route(async (_req, res) => {
      res.json(service.disconnectCalendar(userId(res)));
    }),
  );

  app.get(
    "/api/admin/slots",
    route(async (req, res) => {
      requireAdmin(req);
      res.json({ slots: service.listAdminSlots() });
    }),
  );

  app.post(
    "/api/admin/slots",
    route(async (req, res) => {
      requireAdmin(req);
      res.status(201).json({ slot: service.createAdminSlot(adminSlotSchema.parse(req.body)) });
    }),
  );

  app.patch(
    "/api/admin/slots/:id",
    route(async (req, res) => {
      requireAdmin(req);
      const body = z
        .object({
          capacity: z.number().int().min(1).max(50).optional(),
          pricePence: z.number().int().min(50).max(100_000).optional(),
          title: z.string().trim().min(2).max(80).optional(),
          level: levelSchema.optional(),
          location: z.string().trim().min(2).max(80).optional(),
          address: z.string().trim().min(2).max(120).optional(),
          instructor: z.string().trim().min(2).max(80).optional(),
          blurb: z.string().trim().min(2).max(400).optional(),
          cancelled: z.boolean().optional(),
        })
        .parse(req.body);
      res.json({ slot: service.updateAdminSlot(param(req.params.id), body) });
    }),
  );

  app.get(
    "/api/admin/rules",
    route(async (req, res) => {
      requireAdmin(req);
      res.json({ rules: service.listAdminRules() });
    }),
  );

  app.post(
    "/api/admin/rules",
    route(async (req, res) => {
      requireAdmin(req);
      res.status(201).json({ rule: service.createAdminRule(adminRuleSchema.parse(req.body)) });
    }),
  );

  app.put(
    "/api/admin/rules/:id",
    route(async (req, res) => {
      requireAdmin(req);
      res.json({ rule: service.updateAdminRule(param(req.params.id), adminRuleSchema.parse(req.body)) });
    }),
  );

  app.post(
    "/api/admin/rules/:id/enabled",
    route(async (req, res) => {
      requireAdmin(req);
      const enabled = z.object({ enabled: z.boolean() }).parse(req.body).enabled;
      res.json({ rule: service.setAdminRuleEnabled(param(req.params.id), enabled) });
    }),
  );

  app.get(
    "/admin/login",
    route(async (req, res) => {
      if (!deps.config.adminToken) {
        res.status(404).type("html").send(adminDisabledPage());
        return;
      }
      if (adminAuthed(req)) {
        res.redirect(303, "/admin");
        return;
      }
      res.type("html").send(adminLoginPage(queryValue(req.query.error)));
    }),
  );

  app.post(
    "/admin/login",
    route(async (req, res) => {
      if (!deps.config.adminToken) {
        res.status(404).type("html").send(adminDisabledPage());
        return;
      }
      const token = field(req.body, "token");
      if (!tokensMatch(token, deps.config.adminToken)) {
        res.type("html").send(adminLoginPage("That admin token didn't match."));
        return;
      }
      res.setHeader(
        "Set-Cookie",
        `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
      );
      res.redirect(303, "/admin");
    }),
  );

  app.get("/admin/logout", (_req, res) => {
    res.setHeader("Set-Cookie", `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.redirect(303, "/admin/login");
  });

  app.get(
    "/admin",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      res.type("html").send(
        adminOverviewPage({
          rules: service.listAdminRules(),
          upcoming: service.listAdminSlots(),
          notice: queryValue(req.query.notice),
        }),
      );
    }),
  );

  app.get(
    "/admin/availability",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      res.type("html").send(
        adminAvailabilityPage({
          rules: service.listAdminRules(),
          editId: queryValue(req.query.edit),
          notice: queryValue(req.query.notice),
        }),
      );
    }),
  );

  app.post(
    "/admin/rules",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      service.createAdminRule(ruleFromForm(req.body));
      res.redirect(303, "/admin/availability?notice=" + encodeURIComponent("Weekly class added."));
    }),
  );

  app.post(
    "/admin/rules/:id",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      service.updateAdminRule(param(req.params.id), ruleFromForm(req.body));
      res.redirect(303, "/admin/availability?notice=" + encodeURIComponent("Weekly class updated."));
    }),
  );

  app.post(
    "/admin/rules/:id/toggle",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      const enabled = field(req.body, "enabled") === "1";
      service.setAdminRuleEnabled(param(req.params.id), enabled);
      res.redirect(
        303,
        "/admin/availability?notice=" + encodeURIComponent(enabled ? "Weekly class turned on." : "Weekly class turned off."),
      );
    }),
  );

  app.get(
    "/admin/sessions",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      res.type("html").send(
        adminSessionsPage({
          slots: service.listAdminSlots(),
          notice: queryValue(req.query.notice),
        }),
      );
    }),
  );

  app.post(
    "/admin/slots",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      service.createAdminSlot(oneOffFromForm(req.body));
      res.redirect(303, "/admin/sessions?notice=" + encodeURIComponent("One-off session added."));
    }),
  );

  app.post(
    "/admin/slots/:id/cancel",
    route(async (req, res) => {
      if (!requireAdminPage(req, res)) return;
      const cancelled = field(req.body, "cancelled") === "1";
      service.updateAdminSlot(param(req.params.id), { cancelled });
      res.redirect(
        303,
        "/admin/sessions?notice=" + encodeURIComponent(cancelled ? "Session cancelled for customers." : "Session restored."),
      );
    }),
  );

  app.use((_req, res) => {
    sendError(res, 404, "NOT_FOUND", "That route doesn't exist.");
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof ZodError) {
      sendError(res, 400, "VALIDATION", error.issues[0]?.message ?? "Check the form and try again.");
      return;
    }
    if (error instanceof AppError) {
      if (_req.path.startsWith("/admin") && !(_req.path.startsWith("/api/"))) {
        res.status(error.status).type("html").send(adminLoginPage(error.message));
        return;
      }
      sendError(res, error.status, error.code, error.message);
      return;
    }
    console.error(error);
    sendError(res, 500, "INTERNAL", "Something went wrong. Please try again.");
  });

  return app;
}
