import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import { z } from "zod";
import { DateTime } from "luxon";
import type { DatabaseSync } from "node:sqlite";
import { readAccessToken } from "./auth.js";
import type { CalendarGateway } from "./calendar.js";
import type { AppConfig } from "./config.js";
import { AppError } from "./errors.js";
import { infoPage, mockCheckoutPage, redirectPage } from "./pages.js";
import { isMockPayments, type PaymentProvider, type WebhookVerifier } from "./payments.js";
import { appendQuery, isAllowedReturnUrl } from "./return-url.js";
import { createService, type LidoService } from "./service.js";

export type AppDeps = {
  db: DatabaseSync;
  config: AppConfig;
  payments: PaymentProvider;
  calendar: CalendarGateway;
  clock?: () => DateTime;
  verifyWebhook?: WebhookVerifier;
};

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

const adminSlotSchema = z.object({
  startsAt: z.string().min(10, "Enter a start time."),
  durationMinutes: z.number().int().min(15).max(180),
  capacity: z.number().int().min(1).max(50),
  pricePence: z.number().int().min(50).max(100_000),
  title: z.string().trim().min(2).max(80),
  level: z.enum(["Beginners", "Improvers", "Confidence", "Technique"]),
  location: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(120),
  instructor: z.string().trim().min(2).max(80),
  blurb: z.string().trim().min(2).max(400),
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "lido-api" });
  });

  app.get("/api/config", (_req, res) => {
    res.json(service.publicConfig());
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
      sendError(res, error.status, error.code, error.message);
      return;
    }
    console.error(error);
    sendError(res, 500, "INTERNAL", "Something went wrong. Please try again.");
  });

  return app;
}
