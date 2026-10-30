CREATE TABLE "organization_entitlements" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"signed_grant" jsonb NOT NULL,
	"highest_sequence" integer NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_sequence_positive" CHECK ("organization_entitlements"."highest_sequence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "organization_entitlements" ADD CONSTRAINT "organization_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;