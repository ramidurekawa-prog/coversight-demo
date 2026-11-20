CREATE TABLE "daily_days" (
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"day" text NOT NULL,
	"source" text NOT NULL,
	"summary" jsonb NOT NULL,
	"complete" boolean DEFAULT true NOT NULL,
	"checks" jsonb,
	"version" text DEFAULT '' NOT NULL,
	"user_id" text,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_days_org_id_room_id_day_pk" PRIMARY KEY("org_id","room_id","day")
);
--> statement-breakpoint
CREATE TABLE "daily_notes" (
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"day" text NOT NULL,
	"text" text NOT NULL,
	"user_id" text,
	"author" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_notes_org_id_room_id_day_pk" PRIMARY KEY("org_id","room_id","day")
);
--> statement-breakpoint
ALTER TABLE "daily_days" ADD CONSTRAINT "daily_days_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_days" ADD CONSTRAINT "daily_days_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_notes" ADD CONSTRAINT "daily_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;