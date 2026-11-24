CREATE TABLE "shadow_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"date" text NOT NULL,
	"meal" text NOT NULL,
	"state" text NOT NULL,
	"entry" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"graded" jsonb,
	"graded_at" timestamp with time zone,
	CONSTRAINT "shadow_calls_service" UNIQUE("org_id","room_id","date","meal")
);
--> statement-breakpoint
ALTER TABLE "shadow_calls" ADD CONSTRAINT "shadow_calls_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shadow_calls_room_idx" ON "shadow_calls" USING btree ("org_id","room_id","date");