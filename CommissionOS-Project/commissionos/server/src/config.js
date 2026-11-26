require("dotenv").config();

const list = (v) =>
  String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
const env = process.env;

const config = {
  nodeEnv: env.NODE_ENV || "development",
  isProd: env.NODE_ENV === "production",
  port: Number(env.PORT) || 4000,
  corsOrigins: list(
    env.CORS_ORIGINS ||
      "http://localhost:5173,https://commissionos.netlify.app",
  ),

  clientUrl: (env.CLIENT_URL || "https://commissionos.netlify.app").replace(
    /\/$/,
    "",
  ),
  jwtSecret: env.JWT_SECRET || "dev-only-insecure-secret",
  jwtExpiresIn: env.JWT_EXPIRES_IN || "7d",
  admin: {
    name: env.ADMIN_NAME || "Administrator",
    email: (env.ADMIN_EMAIL || "admin@aurontech.in").toLowerCase(),
    password: env.ADMIN_PASSWORD || "Admin@123",
  },
  adminGoogleEmails: list(
    env.ADMIN_GOOGLE_EMAILS || env.ADMIN_EMAIL || "admin@aurontech.in",
  ).map((e) => e.toLowerCase()),
  googleClientId: env.GOOGLE_CLIENT_ID || "",
  allowDemoGoogle: env.ALLOW_DEMO_GOOGLE === "true",
  autoSeed: env.AUTO_SEED !== "false",
  smtp: {
    host: env.SMTP_HOST || "",
    port: Number(env.SMTP_PORT) || 587,
    user: env.SMTP_USER || "",
    pass: env.SMTP_PASS || "",
    from: env.MAIL_FROM || "Auron CommissionOS <no-reply@example.com>",
  },
  supportEmail: env.SUPPORT_EMAIL || "poojitha@alphaauron.com",
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID || "",
    keySecret: env.RAZORPAY_KEY_SECRET || "",
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET || "",
  },
  // the very first subscription of the workspace is free for this many days
  freeFirstSubscription: env.FREE_FIRST_SUBSCRIPTION !== "false",
  freeTrialDays: Number(env.FREE_TRIAL_DAYS) || 30,
};

if (
  config.isProd &&
  (config.jwtSecret === "dev-only-insecure-secret" ||
    config.jwtSecret.length < 32)
) {
  throw new Error(
    "JWT_SECRET must be set to a long random value (32+ characters) in production.",
  );
}
if (config.isProd && config.allowDemoGoogle) {
  throw new Error("ALLOW_DEMO_GOOGLE must be false in production.");
}

module.exports = config;
