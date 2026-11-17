ALTER TYPE "public"."member_role" ADD VALUE 'floor';--> statement-breakpoint
CREATE TABLE "service_live" (
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"day" text NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"staff" jsonb,
	"manual" jsonb,
	"pulled_at" timestamp with time zone,
	"staff_at" timestamp with time zone,
	"error" text,
	"staff_error" text,
	CONSTRAINT "service_live_org_id_room_id_day_pk" PRIMARY KEY("org_id","room_id","day")
);
--> statement-breakpoint
CREATE TABLE "staff_connections" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT '7shifts' NOT NULL,
	"company_id" text NOT NULL,
	"token_sealed" text NOT NULL,
	"locations" jsonb NOT NULL,
	"server_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "service_live" ADD CONSTRAINT "service_live_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_connections" ADD CONSTRAINT "staff_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_connections" ADD CONSTRAINT "staff_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;