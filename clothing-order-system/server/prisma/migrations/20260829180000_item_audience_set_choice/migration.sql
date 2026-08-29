-- Clothing category (men / women / kids boy / kids girl) and the shirt/trouser
-- or accessory option chosen when the item was added. Legacy rows stay empty.

ALTER TABLE "order_items" ADD COLUMN "audience" TEXT NOT NULL DEFAULT '';
ALTER TABLE "order_items" ADD COLUMN "setChoice" TEXT NOT NULL DEFAULT '';

CREATE INDEX "order_items_audience_idx" ON "order_items"("audience");
