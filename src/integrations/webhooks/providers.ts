export const webhookProviders = [
  { name: "Generic", value: "generic" },
  { name: "Uptime Kuma", value: "uptimeKuma" },
] as const;

export type WebhookProvider = typeof webhookProviders[number]["value"];
export const providerName = (provider: WebhookProvider) => webhookProviders.find(item => item.value === provider)!.name;
