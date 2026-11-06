CREATE TABLE "organization_write_controls" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"reason" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_setup_tokens" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"initial_password_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "owner_setup_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "organization_write_controls" ADD CONSTRAINT "organization_write_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_setup_tokens" ADD CONSTRAINT "owner_setup_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_setup_tokens" ADD CONSTRAINT "owner_setup_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE SCHEMA platform_operator;
--> statement-breakpoint
REVOKE ALL ON SCHEMA platform_operator FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE platform_operator.receipts(id uuid PRIMARY KEY,kind text NOT NULL,payload jsonb NOT NULL,result jsonb NOT NULL,committed_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE FUNCTION platform_operator.lookup(target uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('runtimeId',o.id,'name',o.name,'paused',coalesce(c.paused,false),'setupComplete',s.organization_id IS NULL OR s.accepted_at IS NOT NULL,'entitlement',e.signed_grant,'observedAt',now())
 FROM public.organizations o LEFT JOIN public.organization_write_controls c ON c.organization_id=o.id LEFT JOIN public.owner_setup_tokens s ON s.organization_id=o.id LEFT JOIN public.organization_entitlements e ON e.organization_id=o.id WHERE o.id=target AND o.edition='saas'
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_operator.lookup(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION platform_operator.execute(operation uuid,action text,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE old platform_operator.receipts%ROWTYPE; target uuid; person public.users%ROWTYPE; org public.organizations%ROWTYPE; setup public.owner_setup_tokens%ROWTYPE; grantrow public.organization_entitlements%ROWTYPE; claims jsonb; envelope jsonb; result jsonb; inserted integer; roleid uuid;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(operation::text,73492610));
 SELECT * INTO old FROM platform_operator.receipts WHERE id=operation;
 IF FOUND THEN IF old.kind<>action OR old.payload<>body THEN RAISE EXCEPTION 'operation conflict' USING ERRCODE='22023'; END IF; RETURN old.result; END IF;
 target:=(body->>'runtimeId')::uuid;
 IF action='provision' THEN
  IF length(trim(body->>'name')) NOT BETWEEN 1 AND 200 OR (body->>'email')<>lower(trim(body->>'email')) OR length(body->>'passwordHash')<20 THEN RAISE EXCEPTION 'invalid setup'; END IF;
  INSERT INTO public.users(id,edition,email,name,password_hash,must_change_password) VALUES(gen_random_uuid(),'saas',body->>'email',body->>'contactName',body->>'passwordHash',true) ON CONFLICT(edition,email) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  SELECT * INTO person FROM public.users WHERE edition='saas' AND email=body->>'email' FOR UPDATE;
  IF person.status<>'active' THEN RAISE EXCEPTION 'account unavailable'; END IF;
  INSERT INTO public.organizations(id,name,edition) VALUES(target,body->>'name','saas');
  INSERT INTO public.organization_memberships(id,organization_id,user_id,edition,is_owner,accepted_at) VALUES(gen_random_uuid(),target,person.id,'saas',true,now());
  roleid:=gen_random_uuid();INSERT INTO public.roles(id,organization_id,name,system) VALUES(roleid,target,'Administrator',true);
  INSERT INTO public.role_permissions(organization_id,role_id,permission_key,delegable) SELECT target,roleid,key,false FROM public.permissions;
  roleid:=gen_random_uuid();INSERT INTO public.roles(id,organization_id,name,system) VALUES(roleid,target,'Staff',true);
  INSERT INTO public.role_permissions(organization_id,role_id,permission_key,delegable) VALUES(target,roleid,'organization.read',false);
  INSERT INTO public.owner_setup_tokens(organization_id,user_id,token_hash,initial_password_hash,expires_at) VALUES(target,person.id,md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),CASE WHEN inserted>0 THEN body->>'passwordHash' ELSE NULL END,now());
  result:=jsonb_build_object('runtimeId',target,'setupPending',true);
 ELSE
  SELECT * INTO org FROM public.organizations WHERE id=target AND edition='saas' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'organization unavailable'; END IF;
  IF action='setup_link' THEN
   IF (body->>'tokenHash') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid token'; END IF;
   SELECT * INTO setup FROM public.owner_setup_tokens WHERE organization_id=target FOR UPDATE;
   IF NOT FOUND OR setup.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'setup already completed'; END IF;
   UPDATE public.owner_setup_tokens SET token_hash=body->>'tokenHash',expires_at=now()+interval '24 hours' WHERE organization_id=target;
   result:=jsonb_build_object('runtimeId',target,'expiresAt',now()+interval '24 hours');
  ELSIF action='pause' THEN
   IF length(trim(body->>'reason')) NOT BETWEEN 1 AND 1000 OR jsonb_typeof(body->'paused')<>'boolean' THEN RAISE EXCEPTION 'invalid pause'; END IF;
   INSERT INTO public.organization_write_controls(organization_id,paused,reason) VALUES(target,(body->>'paused')::boolean,body->>'reason') ON CONFLICT(organization_id) DO UPDATE SET paused=excluded.paused,reason=excluded.reason,updated_at=now();
   result:=jsonb_build_object('runtimeId',target,'paused',(body->>'paused')::boolean);
  ELSIF action='install_grant' THEN
   envelope:=body->'envelope';claims:=convert_from(decode(translate(envelope->>'payload','-_','+/')||repeat('=',(4-length(envelope->>'payload')%4)%4),'base64'),'UTF8')::jsonb;
   IF claims->>'organizationId'<>target::text OR claims->>'edition'<>'saas' OR claims->'installationId'<>'null'::jsonb THEN RAISE EXCEPTION 'grant binding conflict'; END IF;
   SELECT * INTO grantrow FROM public.organization_entitlements WHERE organization_id=target;
   IF FOUND AND ((claims->>'sequence')::integer<grantrow.highest_sequence OR ((claims->>'sequence')::integer=grantrow.highest_sequence AND envelope<>grantrow.signed_grant) OR grantrow.last_observed_at>now()) THEN RAISE EXCEPTION 'grant sequence conflict'; END IF;
   INSERT INTO public.organization_entitlements(organization_id,signed_grant,highest_sequence,last_observed_at) VALUES(target,envelope,(claims->>'sequence')::integer,now()) ON CONFLICT(organization_id) DO UPDATE SET signed_grant=excluded.signed_grant,highest_sequence=excluded.highest_sequence,last_observed_at=now(),installed_at=now();
   result:=jsonb_build_object('runtimeId',target,'sequence',(claims->>'sequence')::integer,'appliedAt',now());
  ELSE RAISE EXCEPTION 'unsupported operator action' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO public.audit_events(organization_id,action,target_id,metadata) VALUES(target,'platform.'||action,target,jsonb_build_object('operationId',operation));
 INSERT INTO platform_operator.receipts(id,kind,payload,result) VALUES(operation,action,body,result);RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_operator.execute(uuid,text,jsonb) FROM PUBLIC;
