import mongoose from "mongoose";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";

const CustomerSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: DEFAULT_TENANT_ID, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    secondaryPhone: { type: String, default: "", trim: true }
  },
  { timestamps: true }
);

CustomerSchema.index({ tenantId: 1, phone: 1 }, { unique: true });

export const Customer =
  mongoose.models.Customer || mongoose.model("Customer", CustomerSchema);
