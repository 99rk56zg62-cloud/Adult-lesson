export type AppConfig = {
  port: number;
  databasePath: string;
  jwtSecret: string;
  bcryptRounds: number;
  apiPublicUrl: string;
  appWebUrl: string;
  paymentsMode: "stripe" | "mock";
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  adminToken: string | null;
  seedDemoUser: boolean;
  exposeDemoLogin: boolean;
  nodeEnv: string;
};

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "true" || value === "1";
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  const stripeSecretKey = clean(env.STRIPE_SECRET_KEY);
  const requestedMode = clean(env.PAYMENTS_MODE);
  let paymentsMode: "stripe" | "mock";
  if (requestedMode === "stripe" || requestedMode === "mock") {
    paymentsMode = requestedMode;
  } else if (requestedMode) {
    throw new Error("PAYMENTS_MODE must be stripe or mock.");
  } else {
    paymentsMode = stripeSecretKey ? "stripe" : "mock";
  }
  if (paymentsMode === "stripe" && !stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY is required when PAYMENTS_MODE=stripe.");
  }

  const jwtSecret = clean(env.JWT_SECRET);
  if (!jwtSecret && nodeEnv === "production") {
    throw new Error("JWT_SECRET is required in production.");
  }

  const seedDemoUser = flag(env.SEED_DEMO_USER, nodeEnv !== "production");
  return {
    port: Number(env.PORT) || 4000,
    databasePath: clean(env.DB_PATH) ?? "./data/lido.sqlite",
    jwtSecret: jwtSecret ?? "dev-only-change-me",
    bcryptRounds: nodeEnv === "test" ? 4 : 10,
    apiPublicUrl: stripSlash(clean(env.API_PUBLIC_URL) ?? "http://localhost:4000"),
    appWebUrl: stripSlash(clean(env.APP_WEB_URL) ?? "http://localhost:8081"),
    paymentsMode,
    stripeSecretKey,
    stripeWebhookSecret: clean(env.STRIPE_WEBHOOK_SECRET),
    googleClientId: clean(env.GOOGLE_CLIENT_ID),
    googleClientSecret: clean(env.GOOGLE_CLIENT_SECRET),
    adminToken: clean(env.ADMIN_TOKEN),
    seedDemoUser,
    exposeDemoLogin: flag(env.EXPOSE_DEMO_LOGIN, nodeEnv !== "production" && seedDemoUser),
    nodeEnv,
  };
}
