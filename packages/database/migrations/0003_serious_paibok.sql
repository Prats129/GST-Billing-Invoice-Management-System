CREATE TABLE "invoice_lines" (
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_id" varchar(80) NOT NULL,
	"catalog_item_id" uuid NOT NULL,
	"description" varchar(1200) NOT NULL,
	"hsn_sac" varchar(8) NOT NULL,
	"quantity" numeric(15, 6) NOT NULL,
	"supply_value" numeric(18, 2) NOT NULL,
	"tax_total" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL,
	CONSTRAINT "invoice_lines_organization_id_invoice_id_line_id_pk" PRIMARY KEY("organization_id","invoice_id","line_id"),
	CONSTRAINT "invoice_line_valid" CHECK ("invoice_lines"."quantity">0 and "invoice_lines"."supply_value">=0 and "invoice_lines"."tax_total">=0 and "invoice_lines"."total"="invoice_lines"."supply_value"+"invoice_lines"."tax_total")
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"organization_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"financial_year" varchar(4) NOT NULL,
	"document_type" varchar(16) NOT NULL,
	"next_counter" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_series_organization_id_registration_id_financial_year_document_type_pk" PRIMARY KEY("organization_id","registration_id","financial_year","document_type"),
	CONSTRAINT "invoice_series_valid" CHECK ("invoice_series"."next_counter" between 1 and 1000000 and "invoice_series"."financial_year" ~ '^[0-9]{4}$' and "invoice_series"."document_type" in ('invoice','credit_note'))
);
--> statement-breakpoint
CREATE TABLE "invoice_snapshots" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"digest" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "invoice_snapshot_valid" CHECK ("invoice_snapshots"."schema_version"=1 and "invoice_snapshots"."digest" ~ '^[a-f0-9]{64}$' and jsonb_typeof("invoice_snapshots"."payload")='object')
);
--> statement-breakpoint
CREATE TABLE "invoice_tax_components" (
	"organization_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_id" varchar(80) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"rate_percent" numeric(6, 3) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	CONSTRAINT "invoice_tax_components_organization_id_invoice_id_line_id_kind_pk" PRIMARY KEY("organization_id","invoice_id","line_id","kind"),
	CONSTRAINT "invoice_component_valid" CHECK ("invoice_tax_components"."kind" in ('CGST','SGST','UTGST','IGST') and "invoice_tax_components"."rate_percent" between 0 and 100 and "invoice_tax_components"."amount">=0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"customer_name" varchar(200) NOT NULL,
	"document_type" varchar(16) DEFAULT 'invoice' NOT NULL,
	"original_id" uuid,
	"correction_reason" varchar(300) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"financial_year" varchar(4),
	"number" varchar(16),
	"version" integer DEFAULT 1 NOT NULL,
	"draft" jsonb NOT NULL,
	"create_key" uuid NOT NULL,
	"create_digest" varchar(64) NOT NULL,
	"finalize_key" uuid,
	"finalize_digest" varchar(64),
	"finalized_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "invoices_create_key_unique" UNIQUE("organization_id","create_key"),
	CONSTRAINT "invoices_finalize_key_unique" UNIQUE("organization_id","finalize_key"),
	CONSTRAINT "invoices_legal_number_unique" UNIQUE("registration_id","financial_year","number"),
	CONSTRAINT "invoices_state_valid" CHECK ("invoices"."version">0 and jsonb_typeof("invoices"."draft")='object' and
    (("invoices"."document_type"='invoice' and "invoices"."original_id" is null and "invoices"."correction_reason"='') or
     ("invoices"."document_type"='credit_note' and "invoices"."original_id" is not null and length(trim("invoices"."correction_reason"))>=5)) and
    (("invoices"."status"='draft' and "invoices"."number" is null and "invoices"."financial_year" is null and "invoices"."finalized_at" is null and "invoices"."finalize_key" is null and "invoices"."finalize_digest" is null) or
     ("invoices"."status"='finalized' and "invoices"."number" is not null and "invoices"."financial_year" is not null and "invoices"."number" ~ '^[A-Z0-9/-]{1,16}$' and "invoices"."financial_year" ~ '^[0-9]{4}$' and "invoices"."finalized_at" is not null and "invoices"."finalize_key" is not null and "invoices"."finalize_digest" is not null)))
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_invoice_id_invoices_organization_id_id_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_organization_id_catalog_item_id_catalog_items_organization_id_id_fk" FOREIGN KEY ("organization_id","catalog_item_id") REFERENCES "public"."catalog_items"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_organization_id_registration_id_gst_registrations_organization_id_id_fk" FOREIGN KEY ("organization_id","registration_id") REFERENCES "public"."gst_registrations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_snapshots" ADD CONSTRAINT "invoice_snapshots_organization_id_invoice_id_invoices_organization_id_id_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_tax_components" ADD CONSTRAINT "invoice_tax_components_organization_id_invoice_id_line_id_invoice_lines_organization_id_invoice_id_line_id_fk" FOREIGN KEY ("organization_id","invoice_id","line_id") REFERENCES "public"."invoice_lines"("organization_id","invoice_id","line_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_registration_id_gst_registrations_organization_id_id_fk" FOREIGN KEY ("organization_id","registration_id") REFERENCES "public"."gst_registrations"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organization_id_customer_id_customers_organization_id_id_fk" FOREIGN KEY ("organization_id","customer_id") REFERENCES "public"."customers"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_original_tenant_fk" FOREIGN KEY ("organization_id","original_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_full_reversal" ON "invoices" USING btree ("organization_id","original_id") WHERE "invoices"."original_id" is not null;--> statement-breakpoint
CREATE INDEX "invoices_org_date_idx" ON "invoices" USING btree ("organization_id","issue_date","id");--> statement-breakpoint
INSERT INTO public.permissions(key,description) VALUES
('invoices.read','View invoices'),('invoices.manage','Manage invoice drafts'),
('invoices.finalize','Finalize invoices'),('invoices.correct','Create full credit reversals'),
('price.override','Override invoice prices'),('tax.override','Override invoice classifications'),
('place_of_supply.override','Override invoice place of supply');
--> statement-breakpoint
CREATE FUNCTION public.guard_invoice_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='finalized' THEN
    RAISE EXCEPTION 'Finalized documents are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id OR
     NEW.document_type<>OLD.document_type OR NEW.original_id IS DISTINCT FROM OLD.original_id OR
     NEW.create_key<>OLD.create_key OR NEW.create_digest<>OLD.create_digest OR
     NEW.correction_reason<>OLD.correction_reason OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Invalid invoice transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoices_guard BEFORE UPDATE OR DELETE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_invoice_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Financial rows are append only' USING ERRCODE='23514';
  END IF;
  SELECT status INTO parent_state FROM public.invoices WHERE organization_id=NEW.organization_id AND id=NEW.invoice_id FOR UPDATE;
  IF parent_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Cannot add financial rows to finalized document' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_child();
--> statement-breakpoint
CREATE TRIGGER invoice_taxes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_tax_components FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_child();
--> statement-breakpoint
CREATE TRIGGER invoice_snapshots_guard BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_snapshots FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_child();
--> statement-breakpoint
CREATE FUNCTION public.require_invoice_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc public.invoices; snap jsonb;
BEGIN
  IF TG_TABLE_NAME='invoices' THEN
    SELECT * INTO doc FROM public.invoices WHERE id=NEW.id;
  ELSE
    SELECT * INTO doc FROM public.invoices WHERE id=NEW.invoice_id;
  END IF;
  IF doc.status='draft' THEN
    IF EXISTS(SELECT 1 FROM public.invoice_snapshots WHERE invoice_id=doc.id) OR EXISTS(SELECT 1 FROM public.invoice_lines WHERE invoice_id=doc.id) THEN
      RAISE EXCEPTION 'Draft cannot have issued financial rows' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
  END IF;
  SELECT payload INTO snap FROM public.invoice_snapshots WHERE organization_id=doc.organization_id AND invoice_id=doc.id;
  IF snap IS NULL OR snap->'print'->>'number' IS DISTINCT FROM doc.number OR snap->'print'->>'issueDate' IS DISTINCT FROM doc.issue_date::text OR jsonb_array_length(snap->'calculation'->'lines') IS DISTINCT FROM
    (SELECT count(*)::integer FROM public.invoice_lines WHERE invoice_id=doc.id) OR
    (SELECT sum(total) FROM public.invoice_lines WHERE invoice_id=doc.id) IS DISTINCT FROM (snap->'calculation'->'totals'->>'total')::numeric OR
    (SELECT sum(supply_value) FROM public.invoice_lines WHERE invoice_id=doc.id) IS DISTINCT FROM (snap->'calculation'->'totals'->>'supplyValue')::numeric OR
    (SELECT sum(tax_total) FROM public.invoice_lines WHERE invoice_id=doc.id) IS DISTINCT FROM (snap->'calculation'->'totals'->>'taxTotal')::numeric OR
    EXISTS(SELECT 1 FROM public.invoice_lines l WHERE l.invoice_id=doc.id AND l.tax_total IS DISTINCT FROM
      coalesce((SELECT sum(c.amount) FROM public.invoice_tax_components c WHERE c.invoice_id=l.invoice_id AND c.line_id=l.line_id),0)) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'calculation'->'lines') l WHERE NOT EXISTS
      (SELECT 1 FROM public.invoice_lines n WHERE n.invoice_id=doc.id AND n.line_id=l->>'id'
       AND n.quantity=(l->>'quantity')::numeric AND n.hsn_sac=l->>'hsnSac'
       AND n.supply_value=(l->>'supplyValue')::numeric AND n.tax_total=(l->>'taxTotal')::numeric AND n.total=(l->>'total')::numeric)) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'calculation'->'lines') l WHERE
      jsonb_array_length(l->'taxComponents')<>(SELECT count(*) FROM public.invoice_tax_components c WHERE c.invoice_id=doc.id AND c.line_id=l->>'id')) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(snap->'calculation'->'lines') l CROSS JOIN LATERAL jsonb_array_elements(l->'taxComponents') component WHERE NOT EXISTS
      (SELECT 1 FROM public.invoice_tax_components c WHERE c.invoice_id=doc.id AND c.line_id=l->>'id' AND c.kind=component->>'kind' AND c.amount=(component->>'amount')::numeric AND c.rate_percent=(component->>'ratePercent')::numeric)) THEN
    RAISE EXCEPTION 'Invoice snapshot and financial rows must reconcile' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoice_complete AFTER INSERT OR UPDATE ON public.invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_invoice_snapshot();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoice_snapshot_complete AFTER INSERT ON public.invoice_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_invoice_snapshot();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER invoice_lines_complete AFTER INSERT ON public.invoice_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_invoice_snapshot();
--> statement-breakpoint
CREATE FUNCTION public.guard_invoice_series() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.organization_id<>OLD.organization_id OR NEW.registration_id<>OLD.registration_id OR NEW.financial_year<>OLD.financial_year OR NEW.document_type<>OLD.document_type OR NEW.next_counter<>OLD.next_counter+1 THEN
    RAISE EXCEPTION 'Invoice counters cannot be reset or reused' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_series_guard BEFORE UPDATE OR DELETE ON public.invoice_series FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_series();
--> statement-breakpoint
CREATE TRIGGER invoices_no_truncate BEFORE TRUNCATE ON public.invoices FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_lines_no_truncate BEFORE TRUNCATE ON public.invoice_lines FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_tax_no_truncate BEFORE TRUNCATE ON public.invoice_tax_components FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_snapshots_no_truncate BEFORE TRUNCATE ON public.invoice_snapshots FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE TRIGGER invoice_series_no_truncate BEFORE TRUNCATE ON public.invoice_series FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
