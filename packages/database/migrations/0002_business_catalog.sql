CREATE TABLE "business_profiles" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"legal_name" varchar(200) NOT NULL,
	"trade_name" varchar(200) DEFAULT '' NOT NULL,
	"address" jsonb NOT NULL,
	"email" varchar(254) DEFAULT '' NOT NULL,
	"phone" varchar(25) DEFAULT '' NOT NULL,
	"e_invoice_applicability" varchar(16) DEFAULT 'unknown' NOT NULL,
	"bank_name" varchar(120) DEFAULT '' NOT NULL,
	"bank_account_name" varchar(120) DEFAULT '' NOT NULL,
	"bank_account_number" varchar(34) DEFAULT '' NOT NULL,
	"bank_ifsc" varchar(11) DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_valid" CHECK (length(trim("business_profiles"."legal_name")) > 0 and "business_profiles"."version" > 0 and jsonb_typeof("business_profiles"."address") = 'object' and "business_profiles"."e_invoice_applicability" in ('unknown','required','not_required'))
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" varchar(1000) DEFAULT '' NOT NULL,
	"kind" varchar(8) NOT NULL,
	"unit_code" varchar(3) NOT NULL,
	"price" numeric(18, 4) NOT NULL,
	"price_includes_gst" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_items_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "catalog_items_org_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "catalog_items_valid" CHECK ("catalog_items"."version" > 0 and length(trim("catalog_items"."name")) > 0 and "catalog_items"."code" ~ '^[A-Z0-9][A-Z0-9._/-]*$' and "catalog_items"."kind" in ('goods','service') and "catalog_items"."price" between 0 and 99999999999999.9999 and "catalog_items"."unit_code" in ('NOS','KGS','LTR','MTR','HRS','DAY','OTH'))
);
--> statement-breakpoint
CREATE TABLE "catalog_tax_reviews" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reference" varchar(300) NOT NULL,
	CONSTRAINT "catalog_tax_review_reference_nonempty" CHECK (length(trim("catalog_tax_reviews"."reference")) >= 5)
);
--> statement-breakpoint
CREATE TABLE "catalog_tax_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"hsn_sac" varchar(8) NOT NULL,
	"category" varchar(8) NOT NULL,
	"gst_percent" numeric(5, 2) NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_tax_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "catalog_tax_org_item_revision_unique" UNIQUE("organization_id","item_id","revision"),
	CONSTRAINT "catalog_tax_valid" CHECK ("catalog_tax_revisions"."revision" > 0 and "catalog_tax_revisions"."hsn_sac" ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$' and "catalog_tax_revisions"."gst_percent" between 0 and 100 and (("catalog_tax_revisions"."category" = 'taxable' and "catalog_tax_revisions"."gst_percent" > 0) or ("catalog_tax_revisions"."category" in ('nil','exempt') and "catalog_tax_revisions"."gst_percent" = 0)))
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(254) DEFAULT '' NOT NULL,
	"phone" varchar(25) DEFAULT '' NOT NULL,
	"address" jsonb NOT NULL,
	"gstin" varchar(15) DEFAULT '' NOT NULL,
	"notes" varchar(1000) DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "customers_org_code_unique" UNIQUE("organization_id","code"),
	CONSTRAINT "customers_valid" CHECK ("customers"."version" > 0 and length(trim("customers"."name")) > 0 and "customers"."code" ~ '^[A-Z0-9][A-Z0-9._/-]*$' and jsonb_typeof("customers"."address") = 'object' and ("customers"."gstin" = '' or "customers"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'))
);
--> statement-breakpoint
CREATE TABLE "gst_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"gstin" varchar(15) NOT NULL,
	"state_code" varchar(2) NOT NULL,
	"taxpayer_type" varchar(16) DEFAULT 'regular' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gst_registrations_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "gst_registrations_org_gstin_unique" UNIQUE("organization_id","gstin"),
	CONSTRAINT "gst_registration_valid" CHECK ("gst_registrations"."taxpayer_type" = 'regular' and "gst_registrations"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and left("gst_registrations"."gstin",2) = "gst_registrations"."state_code" and ("gst_registrations"."confirmed_at" is null) = ("gst_registrations"."confirmed_by" is null))
);
--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_tax_reviews" ADD CONSTRAINT "catalog_tax_reviews_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_tax_reviews" ADD CONSTRAINT "catalog_tax_reviews_organization_id_revision_id_catalog_tax_revisions_organization_id_id_fk" FOREIGN KEY ("organization_id","revision_id") REFERENCES "public"."catalog_tax_revisions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_tax_revisions" ADD CONSTRAINT "catalog_tax_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_tax_revisions" ADD CONSTRAINT "catalog_tax_revisions_organization_id_item_id_catalog_items_organization_id_id_fk" FOREIGN KEY ("organization_id","item_id") REFERENCES "public"."catalog_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_items_org_archive_name_idx" ON "catalog_items" USING btree ("organization_id","archived_at","name","id");--> statement-breakpoint
CREATE INDEX "customers_org_archive_name_idx" ON "customers" USING btree ("organization_id","archived_at","name","id");--> statement-breakpoint
CREATE UNIQUE INDEX "gst_registration_one_active" ON "gst_registrations" USING btree ("organization_id") WHERE "gst_registrations"."active";
--> statement-breakpoint
INSERT INTO public.permissions (key, description) VALUES
('customers.read', 'View customers'), ('customers.manage', 'Manage customers'),
('catalog.read', 'View products and services'), ('catalog.manage', 'Manage products and services'),
('catalog.tax.verify', 'Review catalog tax classification');
--> statement-breakpoint
CREATE TRIGGER catalog_tax_revision_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.catalog_tax_revisions FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER catalog_tax_review_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.catalog_tax_reviews FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION public.require_catalog_tax_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.catalog_tax_revisions WHERE organization_id=NEW.organization_id AND item_id=NEW.id) THEN
    RAISE EXCEPTION 'Catalog items require a tax revision' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER catalog_requires_tax_revision AFTER INSERT ON public.catalog_items DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_catalog_tax_revision();
