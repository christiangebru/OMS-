import mongoose from "mongoose";
import { ProductionStage } from "../constants/production.js";

const StaffSkillSchema = new mongoose.Schema(
  {
    staffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Staff",
      required: true,
      index: true
    },
    stage: { type: String, enum: ProductionStage, required: true }
  },
  { timestamps: false }
);

StaffSkillSchema.index({ staffId: 1, stage: 1 }, { unique: true });

export const StaffSkill =
  mongoose.models.StaffSkill || mongoose.model("StaffSkill", StaffSkillSchema);
