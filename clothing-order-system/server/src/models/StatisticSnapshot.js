import mongoose from "mongoose";

/**
 * Optional aggregated stats document for fast dashboard reads.
 * Can be refreshed by a cron or after order mutations.
 */
const StatisticSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, default: "global" },
    totalOrders: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 },
    delayedOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    byStatus: { type: mongoose.Schema.Types.Mixed, default: {} },
    byClothingType: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastComputedAt: { type: Date }
  },
  { timestamps: true }
);

export const StatisticSnapshot =
  mongoose.models.StatisticSnapshot ||
  mongoose.model("StatisticSnapshot", StatisticSnapshotSchema);
