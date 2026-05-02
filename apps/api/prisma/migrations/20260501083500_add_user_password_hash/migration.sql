-- Add optional local-auth password hash storage.
ALTER TABLE "users" ADD COLUMN "passwordHash" TEXT;
