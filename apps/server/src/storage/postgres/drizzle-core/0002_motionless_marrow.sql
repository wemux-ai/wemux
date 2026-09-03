-- better-auth 1.7 scopes account identities by issuer. The column must be
-- added safely: nullable first, backfilled per provider, then NOT NULL —
-- otherwise better-auth's startup migration check (UnsafeMigrationError)
-- refuses to boot against a populated table.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = CASE
	WHEN "providerId" = 'credential' THEN 'local:credential'
	WHEN "providerId" = 'google' THEN 'https://accounts.google.com'
	ELSE 'local:oauth:' || "providerId"
END;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;