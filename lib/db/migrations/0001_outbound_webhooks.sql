CREATE TABLE "outbound_webhooks" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "url" text NOT NULL,
  "events" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "secret" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "team_webhook_url_idx" UNIQUE ("team_id","url")
);
--> statement-breakpoint

CREATE INDEX "outbound_webhook_team_idx" ON "outbound_webhooks" ("team_id");
--> statement-breakpoint

CREATE TABLE "webhook_deliveries" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_id" integer NOT NULL,
  "webhook_id" integer NOT NULL,
  "event_id" text NOT NULL,
  "event_type" varchar(100) NOT NULL,
  "payload" jsonb NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "last_status_code" integer,
  "last_error" text,
  "delivered_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_delivery_unique" UNIQUE("webhook_id","event_id")
);
--> statement-breakpoint

CREATE INDEX "webhook_deliveries_team_idx" ON "webhook_deliveries" ("team_id");
--> statement-breakpoint

ALTER TABLE "outbound_webhooks"
  ADD CONSTRAINT "outbound_webhooks_team_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_team_fk"
  FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_webhook_fk"
  FOREIGN KEY ("webhook_id") REFERENCES "outbound_webhooks"("id") ON DELETE CASCADE;
