import mongoose from "mongoose";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { OrderPriority, ProductionStatus } from "../constants/production.js";

const OrderSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: DEFAULT_TENANT_ID, index: true },
    orderId: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true
    },
    groupCode: { type: String, default: "", trim: true },
    requiredCompletionDate: { type: Date, required: true },
    estimatedProductionCompletion: { type: Date },
    productionStatus: {
      type: String,
      enum: ProductionStatus,
      default: "pending"
    },
    priority: {
      type: String,
      enum: OrderPriority,
      default: "NORMAL"
    },
    totalAgreedPrice: { type: Number, default: 0, min: 0 },
    depositPaid: { type: Number, default: 0, min: 0 },
    /** Order-level revenue cache (sum of lineTotals) */
    totalRevenue: { type: Number, default: 0, min: 0 },
    barcodeValue: { type: String, required: true, unique: true, index: true },
    barcodeGeneratedAt: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export const Order = mongoose.models.Order || mongoose.model("Order", OrderSchema);
export { ProductionStatus, OrderPriority };
