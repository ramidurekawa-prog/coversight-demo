ALTER TABLE "invoices" ADD COLUMN "delivery" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "next_delivery_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "delivery_progress" jsonb DEFAULT '{}'::jsonb NOT NULL;