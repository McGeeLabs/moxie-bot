export const moduleDefinitions = [
  { name: "admin", required: true, defaultEnabled: true },
  { name: "status", required: false, defaultEnabled: true },
  { name: "webhooks", required: false, defaultEnabled: false },
  { name: "uptimeKuma", required: false, defaultEnabled: false },
  { name: "valheim", required: false, defaultEnabled: false },
  { name: "moderation", required: false, defaultEnabled: false },
] as const;
