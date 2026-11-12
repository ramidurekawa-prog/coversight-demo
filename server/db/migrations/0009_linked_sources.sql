CREATE TABLE "linked_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"url" text NOT NULL,
	"picks" jsonb NOT NULL,
	"pulled_at" timestamp with time zone,
	"last_error" text,
	"last_result" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "linked_sources" ADD CONSTRAINT "linked_sources_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_sources" ADD CONSTRAINT "linked_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "linked_sources_org_idx" ON "linked_sources" USING btree ("org_id");