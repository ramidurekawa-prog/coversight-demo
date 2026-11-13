CREATE TABLE "meeting_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"meeting_id" uuid,
	"source_key" text NOT NULL,
	"finding_id" text,
	"title" text NOT NULL,
	"owner" text DEFAULT '' NOT NULL,
	"due" text NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"done_when" text DEFAULT '' NOT NULL,
	"approval" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"room_id" text NOT NULL,
	"week" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"agenda_version" text NOT NULL,
	"data_through" text,
	"agenda" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"record" jsonb,
	"version" integer DEFAULT 1 NOT NULL,
	"editor_id" text,
	"locked_until" timestamp with time zone,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meeting_actions" ADD CONSTRAINT "meeting_actions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_actions" ADD CONSTRAINT "meeting_actions_meeting_id_meeting_sessions_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meeting_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_actions" ADD CONSTRAINT "meeting_actions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_editor_id_users_id_fk" FOREIGN KEY ("editor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_sessions" ADD CONSTRAINT "meeting_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_actions_org_room_idx" ON "meeting_actions" USING btree ("org_id","room_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_actions_one_live" ON "meeting_actions" USING btree ("org_id","room_id","source_key") WHERE status in ('open', 'deferred');--> statement-breakpoint
CREATE INDEX "meeting_sessions_org_room_idx" ON "meeting_sessions" USING btree ("org_id","room_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_sessions_one_live" ON "meeting_sessions" USING btree ("org_id","room_id") WHERE status = 'live';