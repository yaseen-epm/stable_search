import { ENV } from "../config/env";
import { getRedisClient } from "./redisClient";

type Entry<T> = {
  value: T;
  expiresAt: number;
};

export class TieredCache {
  private memory = new Map<string, Entry<any>>();

  constructor(
    private ttlSeconds: number,
    private maxItems: number
  ) {}

  private now() {
    return Date.now();
  }

  private isExpired(entry: Entry<any>) {
    return entry.expiresAt <= this.now();
  }

  private evictIfNeeded() {
    while (this.memory.size > this.maxItems) {
      const firstKey = this.memory.keys().next().value;
      if (typeof firstKey !== "string") return;
      this.memory.delete(firstKey);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const inMem = this.memory.get(key);
    if (inMem) {
      if (!this.isExpired(inMem)) {
        return inMem.value as T;
      }
      this.memory.delete(key);
    }

    const redis = await getRedisClient();
    if (!redis) return null;

    try {
      const raw = await redis.get(key);
      if (!raw) return null;

      const parsed = JSON.parse(raw) as T;

      this.memory.set(key, {
        value: parsed,
        expiresAt: this.now() + this.ttlSeconds * 1000
      });
      this.evictIfNeeded();

      return parsed;
    } catch (err: any) {
      console.error("[cache] redis get failed:", err?.message || err);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.memory.set(key, {
      value,
      expiresAt: this.now() + this.ttlSeconds * 1000
    });
    this.evictIfNeeded();

    const redis = await getRedisClient();
    if (!redis) return;

    try {
      await redis.setEx(key, this.ttlSeconds, JSON.stringify(value));
    } catch (err: any) {
      console.error("[cache] redis set failed:", err?.message || err);
    }
  }
}

export const cache = new TieredCache(
  ENV.CACHE_TTL_SECONDS,
  ENV.CACHE_MEMORY_MAX_ITEMS
);
