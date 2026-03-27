import { createClient } from "redis";
import { ENV } from "../config/env";

type AppRedisClient = ReturnType<typeof createClient>;

let client: AppRedisClient | null = null;
let connecting: Promise<AppRedisClient | null> | null = null;

export async function getRedisClient(): Promise<AppRedisClient | null> {
  if (!ENV.REDIS_URL) return null;
  if (client) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c = createClient({ url: ENV.REDIS_URL });

      c.on("error", (err: unknown) => {
        console.error("[redis] error:", (err as any)?.message || err);
      });

      await c.connect();
      client = c;
      return client;
    } catch (err: any) {
      console.error("[redis] connect failed:", err?.message || err);
      client = null;
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}
