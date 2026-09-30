// The Upstash / Vercel KV REST client, in one place.
//
// The same ten lines lived in `redisStore.ts` and `quotationStoreClient.ts` (and the env lookup in three more);
// the admin settings store is a third caller. `RedisConfig` stays exported from both store files because other
// code imports it from there — it is this type.

export interface KvConfig {
  url: string;
  token: string;
}

/** The KV endpoint from the environment, or null when this deployment has none (local dev, tests). */
export function kvConfigFromEnv(env: NodeJS.ProcessEnv = process.env): KvConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

/** One Redis command over the REST protocol: `["SET", "key", "value"]`. Throws on any failure. */
export async function kvCommand<T = unknown>(config: KvConfig, args: (string | number)[]): Promise<T> {
  const res = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Redis command [${args[0]}] failed (${res.status}): ${errText.slice(0, 200)}`);
  }
  const json = (await res.json()) as { result: T; error?: string };
  if (json.error) throw new Error(`Redis command error [${args[0]}]: ${json.error}`);
  return json.result;
}
