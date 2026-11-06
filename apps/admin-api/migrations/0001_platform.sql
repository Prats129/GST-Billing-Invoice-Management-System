CREATE TABLE platform_owner (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), id uuid NOT NULL UNIQUE,
 email text NOT NULL CHECK(email=lower(trim(email))), name text NOT NULL,
 password_hash text NOT NULL, mfa_secret text, last_counter bigint NOT NULL DEFAULT -1,
 recovery_hash text NOT NULL, version integer NOT NULL DEFAULT 1
);
CREATE TABLE platform_sessions (
 token_hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES platform_owner(id),
 csrf_hash text NOT NULL, expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(),
 mfa_verified boolean NOT NULL DEFAULT false, pending_secret text, fresh_at timestamptz
);
CREATE TABLE platform_recovery_codes (hash text PRIMARY KEY, owner_id uuid NOT NULL REFERENCES platform_owner(id));
CREATE TABLE platform_throttle (key text PRIMARY KEY, count integer NOT NULL, started_at timestamptz NOT NULL);
CREATE TABLE platform_organizations (
 id uuid PRIMARY KEY, runtime_id uuid NOT NULL, edition text NOT NULL CHECK(edition IN ('offline','saas')),
 installation_id uuid, name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
 contact_name text NOT NULL DEFAULT '', email text NOT NULL, phone text NOT NULL DEFAULT '',
 state text NOT NULL CHECK(state IN ('pending','registered','archived')), version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(edition,runtime_id),
 CHECK((edition='offline')=(installation_id IS NOT NULL))
);
CREATE INDEX platform_org_directory ON platform_organizations(edition,state,created_at,id);
CREATE TABLE platform_agreements (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES platform_organizations(id),
 kind text NOT NULL CHECK(kind IN ('subscription','perpetual','maintenance')),
 starts_at timestamptz NOT NULL, ends_at timestamptz, due_date date NOT NULL,
 total_paise bigint NOT NULL CHECK(total_paise BETWEEN 0 AND 999999999999),
 reference text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','void')),
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(ends_at IS NULL OR ends_at>starts_at),
 UNIQUE(organization_id,id)
);
CREATE TABLE platform_receipts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, agreement_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise BETWEEN 1 AND 999999999999),
 reference text NOT NULL, received_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,agreement_id) REFERENCES platform_agreements(organization_id,id),
 UNIQUE(agreement_id,id)
);
CREATE TABLE platform_adjustments (
 id uuid PRIMARY KEY, agreement_id uuid NOT NULL, receipt_id uuid NOT NULL,
 amount_paise bigint NOT NULL CHECK(amount_paise>0), kind text NOT NULL CHECK(kind IN ('refund','reversal')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(agreement_id,receipt_id) REFERENCES platform_receipts(agreement_id,id)
);
CREATE TABLE platform_license_requests (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES platform_organizations(id),
 claims jsonb NOT NULL, predecessor jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_grants (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES platform_organizations(id),
 sequence integer NOT NULL CHECK(sequence>0), envelope jsonb NOT NULL, claims jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT now(), UNIQUE(organization_id,sequence), UNIQUE(organization_id,id)
);
CREATE TABLE platform_delivery (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, grant_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('delivery_recorded','operator_confirmed')),
 note text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(organization_id,grant_id) REFERENCES platform_grants(organization_id,id)
);
CREATE TABLE platform_operations (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES platform_organizations(id),
 kind text NOT NULL CHECK(kind IN ('provision','setup_link','install_grant','pause')),
 payload jsonb NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','retryable','conflict','completed')),
 attempts integer NOT NULL DEFAULT 0, lease_until timestamptz, result jsonb, error_code text,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE INDEX platform_operations_pending ON platform_operations(state,next_attempt_at);
CREATE TABLE platform_mutations (id uuid PRIMARY KEY, action text NOT NULL, digest text NOT NULL, result jsonb NOT NULL);
CREATE TABLE platform_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid, organization_id uuid REFERENCES platform_organizations(id),
 action text NOT NULL, target_id uuid, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE platform_control (singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), operations_enabled boolean NOT NULL DEFAULT false);
INSERT INTO platform_control DEFAULT VALUES;
CREATE FUNCTION platform_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only record'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON platform_audit FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER receipts_immutable BEFORE UPDATE OR DELETE ON platform_receipts FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER adjustments_immutable BEFORE UPDATE OR DELETE ON platform_adjustments FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER requests_immutable BEFORE UPDATE OR DELETE ON platform_license_requests FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER grants_immutable BEFORE UPDATE OR DELETE ON platform_grants FOR EACH ROW EXECUTE FUNCTION platform_append_only();
CREATE TRIGGER delivery_immutable BEFORE UPDATE OR DELETE ON platform_delivery FOR EACH ROW EXECUTE FUNCTION platform_append_only();

CREATE TABLE platform_observations(organization_id uuid PRIMARY KEY REFERENCES platform_organizations(id),value jsonb NOT NULL,observed_at timestamptz NOT NULL DEFAULT now());
