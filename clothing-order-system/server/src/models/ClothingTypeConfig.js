import mongoose from "mongoose";
import { ProductionStage, SKIP_EMBROIDERY_SEQUENCE } from "../constants/production.js";

const ClothingTypeConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    stageSequence: {
      type: [{ type: String, enum: ProductionStage }],
      default: () => [...SKIP_EMBROIDERY_SEQUENCE]
    },
    includesEmbroidery: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export const ClothingTypeConfig =
  mongoose.models.ClothingTypeConfig ||
  mongoose.model("ClothingTypeConfig", ClothingTypeConfigSchema);
