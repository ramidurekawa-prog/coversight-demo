CREATE TABLE "pos_days" (
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"day" text NOT NULL,
	"source" text DEFAULT 'toast-api' NOT NULL,
	"items" jsonb NOT NULL,
	"orders" jsonb NOT NULL,
	"time" jsonb NOT NULL,
	"payments" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_days_org_id_room_id_day_pk" PRIMARY KEY("org_id","room_id","day")
);
--> statement-breakpoint
ALTER TABLE "toast_connections" ADD COLUMN "sync_state" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "toast_connections" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "toast_connections" ADD COLUMN "sync_detail" jsonb;--> statement-breakpoint
ALTER TABLE "pos_days" ADD CONSTRAINT "pos_days_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;