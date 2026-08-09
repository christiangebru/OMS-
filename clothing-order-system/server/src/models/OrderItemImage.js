import mongoose from "mongoose";

const OrderItemImageSchema = new mongoose.Schema(
  {
    orderItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderItem",
      required: true,
      index: true
    },
    imageUrl: { type: String, required: true },
    caption: { type: String, default: "" },
    uploadedAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

export const OrderItemImage =
  mongoose.models.OrderItemImage || mongoose.model("OrderItemImage", OrderItemImageSchema);
