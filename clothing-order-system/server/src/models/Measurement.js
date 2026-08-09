import mongoose from "mongoose";

const MeasurementSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true
    },
    chest: { type: Number },
    waist: { type: Number },
    hip: { type: Number },
    shoulder: { type: Number },
    sleeveLength: { type: Number },
    inseam: { type: Number },
    neck: { type: Number },
    notes: { type: String, default: "" },
    recordedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);

export const Measurement =
  mongoose.models.Measurement || mongoose.model("Measurement", MeasurementSchema);
