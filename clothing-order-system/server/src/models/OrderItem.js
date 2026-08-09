import mongoose from "mongoose";
import { NeckType, HandType, SizeCategory } from "../constants/production.js";

const OrderItemSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true
    },
    /** Denormalized business order id for queries */
    orderId: { type: String, required: true, index: true },
    clothingCode: { type: String, required: true, trim: true },
    clothingType: { type: String, required: true, trim: true },
    fabricType: { type: String, required: true, trim: true },
    color: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    notes: { type: String, default: "" },
    neckType: { type: String, enum: NeckType, required: true },
    handType: { type: String, enum: HandType, required: true },
    size: { type: String, enum: SizeCategory, required: true },
    measurements: {
      type: new mongoose.Schema(
        {
          gender: {
            type: String,
            enum: ["female", "male", "kids"],
            required: true
          },
          vest: { type: String, default: "" },
          height: { type: String, default: "" },
          breast: { type: String, default: "" },
          waist: { type: String, default: "" },
          shoulder: { type: String, default: "" },
          arm: { type: String, default: "" },
          chest: { type: String, default: "" }
        },
        { _id: false }
      ),
      default: undefined
    },
    productionDays: { type: Number, default: 3, min: 1 },
    lineTotal: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, default: 0, min: 0 },
    difficultyLevel: { type: Number, default: 3, min: 1, max: 5 },
    barcodeValue: { type: String, required: true, unique: true, index: true },
    barcodeGeneratedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

export const OrderItem =
  mongoose.models.OrderItem || mongoose.model("OrderItem", OrderItemSchema);
