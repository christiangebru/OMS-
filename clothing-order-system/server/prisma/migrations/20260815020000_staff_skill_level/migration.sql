-- Additive per-stage skill level (1–5). Existing rows default to 3.

ALTER TABLE "staff_skills" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 3;
