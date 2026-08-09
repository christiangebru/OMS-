import mongoose from "mongoose";
import { DEFAULT_TENANT_ID } from "../config/tenant.js";
import { StaffRole, StaffStatus } from "../constants/production.js";

const StaffSchema = new mongoose.Schema(
  {
    tenantId: { type: String, required: true, default: DEFAULT_TENANT_ID, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    role: { type: String, enum: StaffRole, required: true },
    status: { type: String, enum: StaffStatus, default: "AVAILABLE" },
    skillLevel: { type: Number, default: 3, min: 1, max: 5 },
    active: { type: Boolean, default: true, index: true }
  },
  { timestamps: { createdAt: true, updatedAt: true } }
);

export const Staff = mongoose.models.Staff || mongoose.model("Staff", StaffSchema);
