CREATE TYPE "WebhookProvider" AS ENUM ('generic', 'uptimeKuma');
ALTER TABLE "WebhookRoute" ADD COLUMN "provider" "WebhookProvider" NOT NULL DEFAULT 'generic';
