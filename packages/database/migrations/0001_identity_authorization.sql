-- Phase 2: reviewed identity, tenant authorization and security invariants.
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "membership_roles_organization_id_membership_id_role_id_pk" PRIMARY KEY("organization_id","membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "memberships_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "memberships_status_valid" CHECK ("organization_memberships"."status" in ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "mfa_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret" text,
	"pending_secret" text,
	"pending_expires_at" timestamp with time zone,
	"last_counter" integer DEFAULT -1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_recovery" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	CONSTRAINT "mfa_recovery_codes_user_id_code_hash_pk" PRIMARY KEY("user_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"organization_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" varchar(80) NOT NULL,
	"delegable" boolean DEFAULT false NOT NULL,
	CONSTRAINT "role_permissions_organization_id_role_id_permission_key_pk" PRIMARY KEY("organization_id","role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	CONSTRAINT "roles_org_id_unique" UNIQUE("organization_id","id"),
	CONSTRAINT "roles_org_name_unique" UNIQUE("organization_id","name"),
	CONSTRAINT "roles_name_nonempty" CHECK (length(trim("roles"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"csrf_hash" varchar(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"edition" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition" varchar(8) NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(120) NOT NULL,
	"password_hash" text NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_edition_email_unique" UNIQUE("edition","email"),
	CONSTRAINT "users_edition_valid" CHECK ("users"."edition" in ('offline', 'saas')),
	CONSTRAINT "users_status_valid" CHECK ("users"."status" in ('active', 'disabled')),
	CONSTRAINT "users_email_normalized" CHECK ("users"."email" = lower(trim("users"."email")) and length("users"."email") > 3),
	CONSTRAINT "users_name_nonempty" CHECK (length(trim("users"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "edition" varchar(8) DEFAULT 'offline' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_id_membership_id_organization_memberships_organization_id_id_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "public"."organization_memberships"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_id_role_id_roles_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_recovery" ADD CONSTRAINT "owner_recovery_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_role_id_roles_organization_id_id_fk" FOREIGN KEY ("organization_id","role_id") REFERENCES "public"."roles"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_date_idx" ON "audit_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_throttle_window_idx" ON "auth_throttle" USING btree ("window_started_at");--> statement-breakpoint
CREATE INDEX "memberships_user_org_idx" ON "organization_memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_edition_valid" CHECK ("organizations"."edition" in ('offline', 'saas'));
--> statement-breakpoint
-- Reviewed ordering: referenced uniqueness must exist before the foreign keys.
ALTER TABLE "organization_memberships" ADD COLUMN "edition" varchar(8) DEFAULT 'offline' NOT NULL;
--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_id_edition_unique" UNIQUE("id","edition");
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_edition_unique" UNIQUE("id","edition");
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "memberships_org_edition_fk" FOREIGN KEY ("organization_id","edition") REFERENCES "public"."organizations"("id","edition");
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "memberships_user_edition_fk" FOREIGN KEY ("user_id","edition") REFERENCES "public"."users"("id","edition");
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_edition_fk" FOREIGN KEY ("user_id","edition") REFERENCES "public"."users"("id","edition");
--> statement-breakpoint
CREATE FUNCTION public.lock_membership_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.organization_id <> NEW.organization_id OR OLD.user_id <> NEW.user_id OR OLD.edition <> NEW.edition) THEN
    RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public.organizations WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END FOR UPDATE;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER lock_membership_organization BEFORE INSERT OR UPDATE OR DELETE ON public.organization_memberships FOR EACH ROW EXECUTE FUNCTION public.lock_membership_organization();
--> statement-breakpoint
CREATE FUNCTION public.lock_user_owner_organizations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public.organizations o WHERE o.id IN (SELECT organization_id FROM public.organization_memberships WHERE user_id = OLD.id AND is_owner) ORDER BY o.id FOR UPDATE;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER lock_user_owner_organizations BEFORE UPDATE OF status ON public.users FOR EACH ROW EXECUTE FUNCTION public.lock_user_owner_organizations();
--> statement-breakpoint
CREATE FUNCTION public.require_active_owner(org_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.organizations WHERE id = org_id AND status = 'active')
     AND NOT EXISTS (SELECT 1 FROM public.organization_memberships m JOIN public.users u ON u.id = m.user_id WHERE m.organization_id = org_id AND m.is_owner AND m.status = 'active' AND u.status = 'active') THEN
    RAISE EXCEPTION 'An active organization requires an active owner' USING ERRCODE = '23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION public.check_membership_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.require_active_owner(CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER membership_owner_invariant AFTER INSERT OR UPDATE OR DELETE ON public.organization_memberships DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_membership_owner();
--> statement-breakpoint
CREATE FUNCTION public.check_organization_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.require_active_owner(NEW.id);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER organization_owner_invariant AFTER INSERT OR UPDATE ON public.organizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_organization_owner();
--> statement-breakpoint
CREATE FUNCTION public.check_user_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id uuid;
BEGIN
  FOR org_id IN SELECT organization_id FROM public.organization_memberships WHERE user_id = NEW.id AND is_owner LOOP
    PERFORM public.require_active_owner(org_id);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER user_owner_invariant AFTER UPDATE ON public.users DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_user_owner();
--> statement-breakpoint
CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
--> statement-breakpoint
INSERT INTO public.permissions (key, description) VALUES
('organization.read', 'View organization'), ('organization.manage', 'Manage organization'),
('members.read', 'View memberships'), ('members.manage', 'Manage memberships'),
('roles.read', 'View roles and permissions'), ('roles.manage', 'Manage roles'), ('audit.read', 'View tenant audit events');

--> statement-breakpoint
ALTER TABLE "organization_memberships" DROP CONSTRAINT "memberships_status_valid";--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "memberships_status_valid" CHECK ("organization_memberships"."status" in ('active', 'suspended', 'invited'));
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD COLUMN "accepted_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "memberships_active_accepted" CHECK ("organization_memberships"."status" <> 'active' or "organization_memberships"."accepted_at" is not null);