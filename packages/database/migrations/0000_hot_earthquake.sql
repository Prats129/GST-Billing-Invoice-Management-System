CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_nonempty" CHECK (length(trim("organizations"."name")) > 0),
	CONSTRAINT "organizations_status_valid" CHECK ("organizations"."status" in ('active', 'suspended', 'archived'))
);
