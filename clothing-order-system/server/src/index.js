import "dotenv/config";
import "express-async-errors";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { connectDb } from "./config/db.js";
import { healthLivenessHandler, readinessHandler } from "./routes/health.js";
import authRoutes from "./routes/auth.js";
import orderRoutes from "./routes/orders.js";
import dashboardRoutes from "./routes/dashboard.js";
import analyticsRoutes from "./routes/analytics.js";
import uploadRoutes from "./routes/upload.js";
import customerRoutes from "./routes/customers.js";
import staffRoutes from "./routes/staff.js";
import orderItemRoutes from "./routes/orderItems.js";
import clothingTypeRoutes from "./routes/clothingTypes.js";
import productionRoutes from "./routes/production.js";
import { refreshStatisticSnapshot } from "./utils/stats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

const corsOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true
  })
);
app.use(express.json({ limit: "2mb" }));

/** Uploaded clothing images */
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

app.get("/health", healthLivenessHandler());
app.get("/ready", readinessHandler());

app.use("/api/auth", authRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/order-items", orderItemRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/clothing-types", clothingTypeRoutes);
app.use("/api/production", productionRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/analytics", analyticsRoutes);

app.use((err, _req, res, _next) => {
  console.error("[error]", err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || "Internal Server Error"
  });
});

function listen() {
  return new Promise((resolve) => {
    app.listen(PORT, () => {
      console.log(`[server] Listening on port ${PORT}`);
      console.log(`[server] CORS origins: ${corsOrigins.join(", ")}`);
      resolve();
    });
  });
}

async function main() {
  // Bind first so Render health checks can succeed even if a later DB
  // snapshot is slow. GET /health is liveness (always 200); GET /ready
  // reports database connectivity.
  await listen();
  try {
    await connectDb();
  } catch (e) {
    console.error("[server] initial database connect failed (non-fatal)", e);
  }
  try {
    await refreshStatisticSnapshot();
  } catch (e) {
    console.error("[server] statistic snapshot failed (non-fatal)", e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
