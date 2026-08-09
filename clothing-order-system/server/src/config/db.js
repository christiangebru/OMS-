import mongoose from "mongoose";

/**
 * Connect to MongoDB Atlas (or any MongoDB URI).
 */
export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  console.log("[db] Connected to MongoDB");
}
