import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import Stripe from "stripe";
import type { AppConfig } from "./config.js";
import { getRow } from "./db.js";
import { AppError } from "./errors.js";

export type CheckoutLine = { title: string; description: string; amountPence: number };

export type CheckoutInput = {
  bookingId: string;
  amountPence: number;
  title: string;
  description: string;
  customerEmail: string;
  reference: string;
  lines?: CheckoutLine[];
  saveCard?: boolean;
  purpose?: "booking" | "balance";
};

export type PaidSession = {
  paid: boolean;
  bookingId: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  purpose: "booking" | "balance";
};

export type OffSessionCharge = {
  customerId: string;
  paymentMethodId: string;
  amountPence: number;
  bookingId: string;
  description: string;
};

export type PaymentProvider = {
  mode: "stripe" | "mock";
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  verifyPaid(sessionId: string): Promise<PaidSession>;
  chargeOffSession(input: OffSessionCharge): Promise<{ ok: true; paymentIntentId: string } | { ok: false; message: string }>;
  describeCard(paymentMethodId: string): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null>;
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

type MockRow = {
  session_id: string;
  booking_id: string;
  token: string;
  paid: number;
  purpose: string | null;
  save_card: number;
};

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
        `INSERT INTO mock_checkouts (session_id, booking_id, token, paid, purpose, save_card) VALUES (?, ?, ?, 0, ?, ?)`,
      ).run(sessionId, input.bookingId, token, input.purpose ?? "booking", input.saveCard ? 1 : 0);
      const url = new URL("/api/payments/mock-checkout", `${config.apiPublicUrl}/`);
      url.searchParams.set("session_id", sessionId);
      url.searchParams.set("token", token);
      return { id: sessionId, url: url.toString() };
    },
    async verifyPaid(sessionId) {
      const row = getRow<MockRow>(db, `SELECT * FROM mock_checkouts WHERE session_id = ?`, sessionId);
      if (!row) return { paid: false, bookingId: null, paymentIntentId: null, customerId: null, paymentMethodId: null, purpose: "booking" };
      const saved = row.paid === 1 && row.save_card === 1;
      return {
        paid: row.paid === 1,
        bookingId: row.booking_id,
        paymentIntentId: row.paid === 1 ? `mock_pi_${sessionId}` : null,
        customerId: saved ? `mock_cus_${row.booking_id}` : null,
        paymentMethodId: saved ? `mock_pm_${row.booking_id}` : null,
        purpose: row.purpose === "balance" ? "balance" : "booking",
      };
    },
    async chargeOffSession(input) {
      if (!input.customerId || !input.paymentMethodId || input.paymentMethodId.endsWith("_fail") || input.amountPence < 1) {
        return { ok: false, message: "The saved card was declined." };
      }
      return { ok: true, paymentIntentId: `mock_pi_balance_${input.bookingId}` };
    },
    async describeCard(paymentMethodId) {
      if (!paymentMethodId) return null;
      return { brand: "visa", last4: "4242", expMonth: 12, expYear: 2028 };
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
  paymentIntents: {
    create(params: Stripe.PaymentIntentCreateParams): Promise<Stripe.PaymentIntent>;
  };
  paymentMethods?: {
    retrieve(id: string): Promise<{ card?: { brand?: string; last4?: string; exp_month: number; exp_year: number } | null }>;
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
          metadata: { bookingId: input.bookingId, reference: input.reference, purpose: input.purpose ?? "booking" },
          customer_creation: input.saveCard ? "always" : undefined,
          payment_intent_data: input.saveCard ? { setup_future_usage: "off_session" } : undefined,
          line_items: (input.lines?.length ? input.lines : [{ title: input.title, description: input.description, amountPence: input.amountPence }]).map(
            (line) => ({
              quantity: 1,
              price_data: {
                currency: "gbp",
                unit_amount: line.amountPence,
                product_data: { name: line.title, description: line.description },
              },
            }),
          ),
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
        const paymentMethod = typeof intent === "string" ? null : intent?.payment_method;
        const paymentMethodId = typeof paymentMethod === "string" ? paymentMethod : paymentMethod?.id ?? null;
        const customer = session.customer;
        return {
          paid: session.payment_status === "paid",
          bookingId,
          paymentIntentId,
          customerId: typeof customer === "string" ? customer : customer?.id ?? null,
          paymentMethodId,
          purpose: session.metadata?.purpose === "balance" ? "balance" : "booking",
        };
      } catch (error) {
        console.error("stripe retrieve failed", error instanceof Error ? error.message : error);
        throw new AppError(502, "PAYMENT_PROVIDER", "Couldn't confirm that Stripe payment. Try again in a moment.");
      }
    },
    async chargeOffSession(input) {
      try {
        const intent = await stripe.paymentIntents.create({
          amount: input.amountPence,
          currency: "gbp",
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          description: input.description,
          metadata: { bookingId: input.bookingId, purpose: "balance" },
        });
        if (intent.status !== "succeeded") {
          return { ok: false, message: "The saved card was declined." };
        }
        return { ok: true, paymentIntentId: intent.id };
      } catch (error) {
        console.error("stripe off-session charge failed", error instanceof Error ? error.message : error);
        return { ok: false, message: "The saved card was declined." };
      }
    },
    async describeCard(paymentMethodId) {
      if (!paymentMethodId || !stripe.paymentMethods) return { brand: "card", last4: "0000", expMonth: 1, expYear: 2030 };
      const method = await stripe.paymentMethods.retrieve(paymentMethodId);
      const card = method.card;
      if (!card) return null;
      return { brand: card.brand ?? "card", last4: card.last4 ?? "0000", expMonth: card.exp_month, expYear: card.exp_year };
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
