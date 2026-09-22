import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "./db.js";
import { AppError } from "./errors.js";
import { createMockPayments, createStripePaymentsFromClient, type PaymentProvider } from "./payments.js";
import type { AppConfig } from "./config.js";

const config = {
  port: 0,
  databasePath: ":memory:",
  jwtSecret: "test-secret",
  bcryptRounds: 4,
  apiPublicUrl: "http://127.0.0.1:4000",
  appWebUrl: "http://127.0.0.1:8081",
  paymentsMode: "stripe",
  stripeSecretKey: "sk_test_placeholder",
  stripeWebhookSecret: "whsec_test",
  googleClientId: null,
  googleClientSecret: null,
  adminToken: null,
  seedDemoUser: false,
  exposeDemoLogin: false,
  nodeEnv: "test",
} satisfies AppConfig;

test("stripe verification trusts a paid Checkout session and rejects a bad webhook signature", async () => {
  let paymentStatus = "unpaid";
  const stripe = {
    checkout: {
      sessions: {
        async create() {
          return { id: "cs_123", url: "https://checkout.stripe.test/cs_123" };
        },
        async retrieve(id: string) {
          return {
            id,
            payment_status: paymentStatus,
            metadata: { bookingId: "booking_1" },
            client_reference_id: "booking_1",
            payment_intent: "pi_123",
          };
        },
      },
    },
    webhooks: {
      constructEvent() {
        throw new Error("signature mismatch");
      },
    },
  };
  const { provider, verifyWebhook } = createStripePaymentsFromClient(stripe as never, config);
  const unpaid = await provider.verifyPaid("cs_123");
  assert.equal(unpaid.paid, false);
  assert.equal(unpaid.bookingId, "booking_1");
  paymentStatus = "paid";
  const paid = await provider.verifyPaid("cs_123");
  assert.equal(paid.paid, true);
  assert.equal(paid.paymentIntentId, "pi_123");
  assert.ok(verifyWebhook);
  assert.throws(() => verifyWebhook!(Buffer.from("{}"), "bad"), (error: unknown) => {
    return error instanceof AppError && error.code === "STRIPE_SIGNATURE";
  });
});

test("mock checkout tokens are unguessable", () => {
  const db = openDatabase(":memory:");
  const payments: PaymentProvider & { peekToken(token: string): { sessionId: string } } = createMockPayments(db, {
    ...config,
    paymentsMode: "mock",
  });
  assert.throws(() => payments.peekToken("not-a-real-token"), (error: unknown) => {
    return error instanceof AppError && error.status === 404;
  });
  db.close();
});
