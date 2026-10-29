CREATE TABLE "invoice_cancellations" (
	"invoice_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_digest" varchar(64) NOT NULL,
	"reason" varchar(300) NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_cancellation_request_unique" UNIQUE("organization_id","request_key"),
	CONSTRAINT "invoice_cancellation_reason_valid" CHECK (length(trim("invoice_cancellations"."reason"))>=5 and "invoice_cancellations"."request_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_series" DROP CONSTRAINT "invoice_series_valid";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_state_valid";--> statement-breakpoint
DROP INDEX "invoices_one_full_reversal";--> statement-breakpoint
ALTER TABLE "business_profiles" ADD COLUMN "logo_data_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "correction" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_cancellations" ADD CONSTRAINT "invoice_cancellations_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_cancellations" ADD CONSTRAINT "invoice_cancellations_organization_id_invoice_id_invoices_organization_id_id_fk" FOREIGN KEY ("organization_id","invoice_id") REFERENCES "public"."invoices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_original_idx" ON "invoices" USING btree ("organization_id","original_id");--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_valid" CHECK ("invoice_series"."next_counter" between 1 and 1000000 and "invoice_series"."financial_year" ~ '^[0-9]{4}$' and "invoice_series"."document_type" in ('invoice','credit_note','debit_note'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_state_valid" CHECK ("invoices"."version">0 and jsonb_typeof("invoices"."draft")='object' and
    (("invoices"."document_type"='invoice' and "invoices"."original_id" is null and "invoices"."correction_reason"='') or
     ("invoices"."document_type" in ('credit_note','debit_note') and "invoices"."original_id" is not null and length(trim("invoices"."correction_reason"))>=5)) and
    ("invoices"."correction" is null or (jsonb_typeof("invoices"."correction")='object' and "invoices"."original_id" is not null)) and
    (("invoices"."status"='draft' and "invoices"."number" is null and "invoices"."financial_year" is null and "invoices"."finalized_at" is null and "invoices"."finalize_key" is null and "invoices"."finalize_digest" is null) or
     ("invoices"."status"='finalized' and "invoices"."number" is not null and "invoices"."financial_year" is not null and "invoices"."number" ~ '^[A-Z0-9/-]{1,16}$' and "invoices"."financial_year" ~ '^[0-9]{4}$' and "invoices"."finalized_at" is not null and "invoices"."finalize_key" is not null and "invoices"."finalize_digest" is not null)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_invoice_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='finalized' OR EXISTS(SELECT 1 FROM public.invoice_cancellations WHERE invoice_id=OLD.id) THEN
    RAISE EXCEPTION 'Finalized and cancelled documents are immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW.organization_id<>OLD.organization_id OR NEW.id<>OLD.id OR NEW.document_type<>OLD.document_type OR NEW.original_id IS DISTINCT FROM OLD.original_id OR NEW.create_key<>OLD.create_key OR NEW.create_digest<>OLD.create_digest OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Invalid invoice transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_cancellations_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.invoice_cancellations FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
CREATE FUNCTION public.guard_invoice_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent public.invoices;
BEGIN
  SELECT * INTO parent FROM public.invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF parent.organization_id IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION 'Invalid cancellation parent' USING ERRCODE='23514';
  END IF;
  IF parent.status='finalized' AND parent.document_type<>'invoice' THEN RAISE EXCEPTION 'Issued correction notes require an explicit counter-adjustment' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoices n WHERE n.original_id=NEW.invoice_id AND NOT EXISTS(SELECT 1 FROM public.invoice_cancellations c WHERE c.invoice_id=n.id)) THEN
    RAISE EXCEPTION 'Resolve linked corrections before cancellation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_cancel_guard BEFORE INSERT ON public.invoice_cancellations FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_cancellation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.guard_invoice_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Financial rows are append only' USING ERRCODE='23514'; END IF;
  SELECT status INTO parent_state FROM public.invoices WHERE organization_id=NEW.organization_id AND id=NEW.invoice_id FOR UPDATE;
  IF parent_state IS DISTINCT FROM 'draft' OR EXISTS(SELECT 1 FROM public.invoice_cancellations WHERE invoice_id=NEW.invoice_id) THEN
    RAISE EXCEPTION 'Cannot add financial rows to finalized or cancelled document' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.guard_correction_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent public.invoices;
BEGIN
  IF NEW.original_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO parent FROM public.invoices WHERE id=NEW.original_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF parent.id IS NULL OR parent.status<>'finalized' OR parent.document_type<>'invoice' OR EXISTS(SELECT 1 FROM public.invoice_cancellations WHERE invoice_id=parent.id) THEN
    RAISE EXCEPTION 'Corrections require an active finalized original' USING ERRCODE='23514';
  END IF;
  IF NEW.correction IS NOT NULL AND (NEW.correction->>'documentType' IS DISTINCT FROM NEW.document_type OR NEW.correction->>'reason' IS DISTINCT FROM NEW.correction_reason OR NEW.correction->>'issueDate' IS DISTINCT FROM NEW.issue_date::text) THEN
    RAISE EXCEPTION 'Correction metadata must agree with the document' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER correction_parent_guard BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.guard_correction_parent();
--> statement-breakpoint
INSERT INTO public.permissions(key,description) VALUES ('invoices.cancel','Discard drafts and cancel unreported documents when compliance gates permit');
--> statement-breakpoint
CREATE FUNCTION public.require_correction_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_id IS NULL OR NEW.status<>'finalized' THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_lines l WHERE l.invoice_id=NEW.id AND NOT EXISTS(SELECT 1 FROM public.invoice_lines o WHERE o.invoice_id=NEW.original_id AND o.line_id=l.line_id AND o.hsn_sac=l.hsn_sac)) THEN
    RAISE EXCEPTION 'Correction lines must belong to the original invoice' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_tax_components c WHERE c.invoice_id=NEW.id AND NOT EXISTS(SELECT 1 FROM public.invoice_tax_components o WHERE o.invoice_id=NEW.original_id AND o.line_id=c.line_id AND o.kind=c.kind AND o.rate_percent=c.rate_percent)) THEN
    RAISE EXCEPTION 'Correction tax classification must match the original' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_lines o WHERE o.invoice_id=NEW.original_id AND o.supply_value+coalesce((
    SELECT sum(CASE WHEN n.document_type='debit_note' THEN l.supply_value ELSE -l.supply_value END)
    FROM public.invoices n JOIN public.invoice_lines l ON l.invoice_id=n.id AND l.line_id=o.line_id
    WHERE n.original_id=NEW.original_id AND n.status='finalized' AND NOT EXISTS(SELECT 1 FROM public.invoice_cancellations c WHERE c.invoice_id=n.id)),0)<0) OR
    EXISTS(SELECT 1 FROM public.invoice_tax_components o WHERE o.invoice_id=NEW.original_id AND o.amount+coalesce((
    SELECT sum(CASE WHEN n.document_type='debit_note' THEN t.amount ELSE -t.amount END)
    FROM public.invoices n JOIN public.invoice_tax_components t ON t.invoice_id=n.id AND t.line_id=o.line_id AND t.kind=o.kind
    WHERE n.original_id=NEW.original_id AND n.status='finalized' AND NOT EXISTS(SELECT 1 FROM public.invoice_cancellations c WHERE c.invoice_id=n.id)),0)<0) THEN
    RAISE EXCEPTION 'Credits exceed the remaining invoice balance' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER correction_balance_guard AFTER INSERT OR UPDATE ON public.invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.require_correction_balance();
