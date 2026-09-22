import "dotenv/config";
import { DateTime } from "luxon";
import { createApp } from "./app.js";
import { createCalendarGateway } from "./calendar.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { createMockPayments, createStripePayments } from "./payments.js";
import { DEMO_EMAIL, seedDatabase } from "./seed.js";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);
const clock = () => DateTime.now();
seedDatabase(db, clock, { demo: config.seedDemoUser, bcryptRounds: config.bcryptRounds });

const calendar = createCalendarGateway(config);
const stripe = config.paymentsMode === "stripe" ? createStripePayments(config) : null;
const payments = stripe?.provider ?? createMockPayments(db, config);

if (config.jwtSecret === "dev-only-change-me") {
  console.warn("JWT_SECRET is not set. Using an insecure development secret.");
}
if (config.paymentsMode === "mock") {
  console.warn("Payments are in mock mode. Set STRIPE_SECRET_KEY to take Stripe test payments.");
} else if (!config.stripeWebhookSecret) {
  console.warn("STRIPE_WEBHOOK_SECRET is not set. Bookings still confirm when Stripe redirects back.");
}
try {
  const published = new URL(config.apiPublicUrl);
  if (published.port && published.port !== String(config.port)) {
    console.warn(`API_PUBLIC_URL uses port ${published.port}, but the API is listening on ${config.port}.`);
  }
} catch {
  console.warn("API_PUBLIC_URL is not a valid URL.");
}

const app = createApp({
  db,
  config,
  payments,
  calendar,
  clock,
  verifyWebhook: stripe?.verifyWebhook,
});

app.listen(config.port, () => {
  console.log(`Lido API listening on port ${config.port}`);
  console.log(`Public URL ${config.apiPublicUrl}`);
  console.log(`Payments: ${config.paymentsMode}`);
  console.log(`Google Calendar: ${calendar.configured ? "configured" : "not configured"}`);
  if (config.adminToken) {
    console.log(`Admin: ${config.apiPublicUrl}/admin (token configured)`);
  }
  if (config.seedDemoUser) {
    console.log(`Demo swimmer: ${DEMO_EMAIL}`);
  }
});
