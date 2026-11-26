const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const config = require("./config");
const { errorHandler, notFound } = require("./middleware/error");

function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  // CSP is off so the React build (and Google sign-in script) can be served from the same host
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );
  // app.use(cors({
  //   origin(origin, cb) {
  //     if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
  //     return cb(new Error(`Origin ${origin} is not allowed by CORS`));
  //   },
  // }));

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin || config.corsOrigins.includes(origin)) {
          return cb(null, true);
        }

        return cb(new Error(`Origin ${origin} is not allowed by CORS`));
      },

      credentials: true,

      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  );
  // logo upload is sent as a data URL; the raw body is kept for the Razorpay webhook signature check
  app.use(
    express.json({
      limit: "6mb",
      verify: (req, res, buf) => {
        if (req.originalUrl.startsWith("/api/billing/razorpay-webhook"))
          req.rawBody = buf;
      },
    }),
  );
  if (config.nodeEnv !== "test")
    app.use(morgan(config.isProd ? "combined" : "dev"));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again in a few minutes." },
  });
  const contactLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many messages. Please try again later." },
  });

  app.get("/api/health", (req, res) =>
    res.json({ ok: true, time: new Date().toISOString() }),
  );

  app.use("/api/auth", authLimiter, require("./routes/auth"));
  app.use("/api/invites", authLimiter);
  app.post("/api/contact", contactLimiter); // only the public form is rate limited, not the admin inbox

  // public: invites (token based), contact form
  app.use("/api", require("./routes/invites"));
  app.use("/api", require("./routes/contact"));
  // signed-in
  app.use("/api", require("./routes/portal"));
  // admin only
  app.use("/api", require("./routes/bootstrap"));
  app.use("/api", require("./routes/settings"));
  app.use("/api", require("./routes/engine"));
  app.use("/api", require("./routes/billing"));
  app.use("/api", require("./routes/access"));
  app.use("/api", require("./routes/backup"));
  app.use("/api", require("./routes/collections"));

  app.use("/api", notFound);

  // production: serve the built React app from the same server
  const dist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get("*", (req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
