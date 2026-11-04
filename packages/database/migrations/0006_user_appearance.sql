ALTER TABLE "users" ADD COLUMN "theme_mode" varchar(8) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "theme_accent" varchar(8) DEFAULT 'teal' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme_mode_valid" CHECK ("users"."theme_mode" in ('system', 'light', 'dark'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_theme_accent_valid" CHECK ("users"."theme_accent" in ('teal', 'blue', 'violet'));