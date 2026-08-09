import mongoose from "mongoose";

const ProductionLogSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    mongoOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true },
    fromStatus: { type: String },
    toStatus: { type: String },
    notes: { type: String, default: "" },
    metadata: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const ProductionLog =
  mongoose.models.ProductionLog || mongoose.model("ProductionLog", ProductionLogSchema);
