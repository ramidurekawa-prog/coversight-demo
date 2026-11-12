CREATE TABLE "toast_connections" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_sealed" text NOT NULL,
	"restaurants" jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "toast_connections" ADD CONSTRAINT "toast_connections_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "toast_connections" ADD CONSTRAINT "toast_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;