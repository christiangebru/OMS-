import mongoose from "mongoose";
import { ProductionStage } from "../constants/production.js";

const StageCheckpointSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderItem",
      required: true,
      index: true
    },
    stage: { type: String, enum: ProductionStage, required: true },
    checkedInAt: { type: Date, required: true },
    checkedInByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      default: null
    },
    checkedOutAt: { type: Date, default: null },
    checkedOutByStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      default: null
    },
    notes: { type: String, default: "" }
  },
  { timestamps: false }
);

export const StageCheckpoint =
  mongoose.models.StageCheckpoint || mongoose.model("StageCheckpoint", StageCheckpointSchema);
