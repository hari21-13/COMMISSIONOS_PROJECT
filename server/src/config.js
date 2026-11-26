require("dotenv").config();

const clean = (v) =>
  String(v || "")
    .trim()
    .replace(/^["']+|["']+$/g, "");

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => clean(s))
    .filter(Boolean);

const env = process.env;

const smtpPort = Number(clean(env.SMTP_PORT)) || 587;

const config = {
  nodeEnv: clean(env.NODE_ENV) || "development",
  isProd: clean(env.NODE_ENV) === "production",
  port: Number(clean(env.PORT)) || 4000,
  databaseUrl: clean(env.DATABASE_URL),
  corsOrigins: list(
    env.CORS_ORIGINS ||
      "http://localhost:5173,https://commissionos.netlify.app"
  ),
  clientUrl: (
    clean(env.CLIENT_URL) || "https://commissionos.netlify.app"
  ).replace(/\/$/, ""),
  jwtSecret: clean(env.JWT_SECRET) || "dev-only-insecure-secret",
  jwtExpiresIn: clean(env.JWT_EXPIRES_IN) || "7d",
  admin: {
    name: clean(env.ADMIN_NAME) || "Administrator",
    email: (clean(env.ADMIN_EMAIL) || "admin@aurontech.in").toLowerCase(),
    password: clean(env.ADMIN_PASSWORD) || "Admin@123",
  },
  adminGoogleEmails: list(
    env.ADMIN_GOOGLE_EMAILS || env.ADMIN_EMAIL || "admin@aurontech.in"
  ).map((e) => e.toLowerCase()),
  googleClientId: clean(env.GOOGLE_CLIENT_ID) || "",
  allowDemoGoogle: clean(env.ALLOW_DEMO_GOOGLE) === "true",
  autoSeed: clean(env.AUTO_SEED) !== "false",
  smtp: {
    host: clean(env.SMTP_HOST) || "",
    port: smtpPort,
    secure:
      env.SMTP_SECURE !== undefined
        ? clean(env.SMTP_SECURE) === "true"
        : smtpPort === 465,
    user: clean(env.SMTP_USER) || "",
    pass: clean(env.SMTP_PASS) || "",
    from:
      clean(env.MAIL_FROM) || "Auron CommissionOS <no-reply@example.com>",
  },
  supportEmail: clean(env.SUPPORT_EMAIL) || "poojitha@alphaauron.com",
  razorpay: {
    keyId: clean(env.RAZORPAY_KEY_ID) || "",
    keySecret: clean(env.RAZORPAY_KEY_SECRET) || "",
    webhookSecret: clean(env.RAZORPAY_WEBHOOK_SECRET) || "",
  },
  // The very first subscription of the workspace is free for this many days
  freeFirstSubscription: clean(env.FREE_FIRST_SUBSCRIPTION) !== "false",
  freeTrialDays: Number(clean(env.FREE_TRIAL_DAYS)) || 30,
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL must be set in your .env file.");
}

if (
  config.isProd &&
  (config.jwtSecret === "dev-only-insecure-secret" ||
    config.jwtSecret.length < 32)
) {
  throw new Error(
    "JWT_SECRET must be set to a long random value (32+ characters) in production."
  );
}

if (config.isProd && config.allowDemoGoogle) {
  throw new Error("ALLOW_DEMO_GOOGLE must be false in production.");
}

module.exports = config;