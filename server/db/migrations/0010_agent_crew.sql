CREATE TABLE "agent_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"from_agent" text NOT NULL,
	"to_agents" jsonb NOT NULL,
	"room_id" text,
	"payload" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"agent" text NOT NULL,
	"kind" text NOT NULL,
	"room_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"needs" text DEFAULT 'human' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_proposals_org_key" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"agent" text NOT NULL,
	"trigger" text NOT NULL,
	"room_id" text,
	"ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"applied" jsonb NOT NULL,
	"refused" jsonb NOT NULL,
	"notes" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_cycles" ADD CONSTRAINT "agent_cycles_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_cycle_id_agent_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."agent_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_proposals" ADD CONSTRAINT "agent_proposals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_cycle_id_agent_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."agent_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_cycles_org_idx" ON "agent_cycles" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_events_cycle_idx" ON "agent_events" USING btree ("cycle_id","seq");--> statement-breakpoint
CREATE INDEX "agent_proposals_org_status_idx" ON "agent_proposals" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "agent_runs_org_agent_idx" ON "agent_runs" USING btree ("org_id","agent","at");