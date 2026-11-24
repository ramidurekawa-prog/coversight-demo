ALTER TABLE "checkpoints" ALTER COLUMN "services" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD COLUMN "controls" jsonb;