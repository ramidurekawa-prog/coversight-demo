CREATE TYPE "public"."window_status" AS ENUM('running', 'waiting', 'verified', 'rejected', 'reversed', 'stopped');--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window_id" uuid NOT NULL,
	"day" integer NOT NULL,
	"week_end" text NOT NULL,
	"observed" double precision NOT NULL,
	"control_delta" double precision,
	"services" integer NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkpoints_window_day" UNIQUE("window_id","day")
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"org_id" uuid,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshots_org_id_room_id_kind_pk" PRIMARY KEY("org_id","room_id","kind")
);
--> statement-breakpoint
CREATE TABLE "test_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"lever" text NOT NULL,
	"metric" text NOT NULL,
	"dish" text,
	"title" text NOT NULL,
	"direction" text NOT NULL,
	"baseline" double precision NOT NULL,
	"cents_per_unit_week" integer NOT NULL,
	"started_at" text NOT NULL,
	"guard" jsonb NOT NULL,
	"status" "window_status" DEFAULT 'running' NOT NULL,
	"booked_cents" integer DEFAULT 0 NOT NULL,
	"low_cents" integer,
	"point_cents" integer,
	"method" text,
	"day" integer DEFAULT 0 NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_window_id_test_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."test_windows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_windows" ADD CONSTRAINT "test_windows_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_windows" ADD CONSTRAINT "test_windows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_org_idx" ON "job_runs" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "test_windows_org_idx" ON "test_windows" USING btree ("org_id","status");