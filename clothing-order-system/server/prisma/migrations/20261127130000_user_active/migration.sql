-- Owners can switch a login off without deleting it (history keeps the user).
ALTER TABLE "users" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
