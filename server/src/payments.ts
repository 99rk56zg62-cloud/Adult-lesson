import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import Stripe from "stripe";
import type { AppConfig } from "./config.js";
import { getRow } from "./db.js";
import { AppError } from "./errors.js";

export type CheckoutInput = {
  bookingId: string;
  amountPence: number;
  title: string;
  description: string;
  customerEmail: string;
  reference: string;
};

export type PaidSession = {
  paid: boolean;
  bookingId: string | null;
  paymentIntentId: string | null;
};

export type PaymentProvider = {
  mode: "stripe" | "mock";
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  verifyPaid(sessionId: string): Promise<PaidSession>;
};

export type MockPayments = PaymentProvider & {
  markPaidByToken(token: string): { sessionId: string; bookingId: string };
  peekToken(token: string): { sessionId: string; bookingId: string; paid: boolean };
};

export type WebhookEvent = {
  type: string;
  sessionId: string | null;
};

export type WebhookVerifier = (raw: Buffer, signature: string | undefined) => WebhookEvent;

type MockRow = { session_id: string; booking_id: string; token: string; paid: number };

function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createMockPayments(db: DatabaseSync, config: AppConfig): MockPayments {
  return {
    mode: "mock",
    async createCheckout(input) {
      const sessionId = `mock_${randomUUID()}`;
      const token = randomBytes(24).toString("hex");
      db.prepare(
        `INSERT INTO mock_checkouts (session_id, booking_id, token, paid) VALUES (?, ?, ?, 0)`,
      ).run(sessionId, input.bookingId, token);
      const url = new URL("/api/payments/mock-checkout", `${config.apiPublicUrl}/`);
      url.searchParams.set("session_id", sessionId);
      url.searchParams.set("token", token);
      return { id: sessionId, url: url.toString() };
    },
    async verifyPaid(sessionId) {
      const row = getRow<MockRow>(db, `SELECT session_id, booking_id, token, paid FROM mock_checkouts WHERE session_id = ?`, sessionId);
      if (!row) return { paid: false, bookingId: null, paymentIntentId: null };
      return {
        paid: row.paid === 1,
        bookingId: row.booking_id,
        paymentIntentId: row.paid === 1 ? `mock_pi_${sessionId}` : null,
      };
    },
    peekToken(token) {
      const row = getRow<MockRow>(db, `SELECT session_id, booking_id, token, paid FROM mock_checkouts WHERE token = ?`, token);
      if (!row || !tokensMatch(row.token, token)) {
        throw new AppError(404, "NOT_FOUND", "This test payment link is invalid.");
      }
      return { sessionId: row.session_id, bookingId: row.booking_id, paid: row.paid === 1 };
    },
    markPaidByToken(token) {
      const peeked = this.peekToken(token);
      db.prepare(`UPDATE mock_checkouts SET paid = 1 WHERE session_id = ?`).run(peeked.sessionId);
      return { sessionId: peeked.sessionId, bookingId: peeked.bookingId };
    },
  };
}

type StripeClient = {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ id: string; url: string | null }>;
      retrieve(id: string): Promise<Stripe.Checkout.Session>;
    };
  };
  webhooks: {
    constructEvent(payload: Buffer, signature: string, secret: string): Stripe.Event;
  };
};

export function createStripePayments(config: AppConfig): { provider: PaymentProvider; verifyWebhook?: WebhookVerifier } {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required when payments mode is stripe.");
  }
  const stripe = new Stripe(config.stripeSecretKey);
  return createStripePaymentsFromClient(stripe, config);
}

export function createStripePaymentsFromClient(
  stripe: StripeClient,
  config: AppConfig,
): { provider: PaymentProvider; verifyWebhook?: WebhookVerifier } {
  const provider: PaymentProvider = {
    mode: "stripe",
    async createCheckout(input) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: input.customerEmail,
          client_reference_id: input.bookingId,
          locale: "en-GB",
          metadata: { bookingId: input.bookingId, reference: input.reference },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: input.amountPence,
                product_data: {
                  name: input.title,
                  description: input.description,
                },
              },
            },
          ],
          success_url: `${config.apiPublicUrl}/api/payments/return?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${config.apiPublicUrl}/api/payments/cancelled?booking_id=${encodeURIComponent(input.bookingId)}`,
        });
        if (!session.url) {
          throw new AppError(502, "PAYMENT_PROVIDER", "Stripe didn't return a checkout link.");
        }
        return { id: session.id, url: session.url };
      } catch (error) {
        if (error instanceof AppError) throw error;
        console.error("stripe checkout failed", error instanceof Error ? error.message : error);
        throw new AppError(502, "PAYMENT_PROVIDER", "Couldn't open Stripe Checkout. Check the API keys and try again.");
      }
    },
    async verifyPaid(sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const bookingId = session.metadata?.bookingId ?? session.client_reference_id ?? null;
        const intent = session.payment_intent;
        const paymentIntentId = typeof intent === "string" ? intent : intent?.id ?? null;
        return {
          paid: session.payment_status === "paid",
          bookingId,
          paymentIntentId,
        };
      } catch (error) {
        console.error("stripe retrieve failed", error instanceof Error ? error.message : error);
        throw new AppError(502, "PAYMENT_PROVIDER", "Couldn't confirm that Stripe payment. Try again in a moment.");
      }
    },
  };

  const verifyWebhook = config.stripeWebhookSecret
    ? (raw: Buffer, signature: string | undefined): WebhookEvent => {
        if (!signature) {
          throw new AppError(400, "STRIPE_SIGNATURE", "Missing Stripe signature.");
        }
        try {
          const event = stripe.webhooks.constructEvent(raw, signature, config.stripeWebhookSecret!);
          const object = event.data.object as { id?: string };
          const sessionId = event.type.startsWith("checkout.session.") ? object.id ?? null : null;
          return { type: event.type, sessionId };
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw new AppError(400, "STRIPE_SIGNATURE", "Stripe signature didn't match.");
        }
      }
    : undefined;

  return { provider, verifyWebhook };
}

export function isMockPayments(payments: PaymentProvider): payments is MockPayments {
  return payments.mode === "mock" && "markPaidByToken" in payments;
}
