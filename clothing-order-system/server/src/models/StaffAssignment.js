import mongoose from "mongoose";
import { ProductionStage } from "../constants/production.js";

const StaffAssignmentSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true
    },
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderItem",
      required: true,
      index: true
    },
    stage: { type: String, enum: ProductionStage, required: true },
    assignedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
    suggestedStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      default: null
    },
    followedSuggestion: { type: Boolean, default: false }
  },
  { timestamps: false }
);

StaffAssignmentSchema.index({ staffId: 1, completedAt: 1 });
StaffAssignmentSchema.index({ orderItemId: 1, stage: 1, completedAt: 1 });

export const StaffAssignment =
  mongoose.models.StaffAssignment || mongoose.model("StaffAssignment", StaffAssignmentSchema);
