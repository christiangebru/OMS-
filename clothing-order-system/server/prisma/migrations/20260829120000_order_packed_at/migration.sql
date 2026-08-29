-- Order-level packing timestamp. Packing uses the ORD-n barcode after every
-- top-level garment/accessory is complete; not a garment-stage checkpoint.

ALTER TABLE "orders" ADD COLUMN "packedAt" TIMESTAMP(3);
