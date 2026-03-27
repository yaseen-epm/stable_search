// src/config/env.ts
import dotenv from "dotenv";

dotenv.config();

export const ENV = {
  AZURE_OPENAI_KEY: process.env.AZURE_OPENAI_KEY!,
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT!,
  AZURE_DEPLOYMENT: process.env.AZURE_DEPLOYMENT!,
  QDRANT_URL: process.env.QDRANT_URL!,
  AZURE_EMBEDDING_DEPLOYMENT: process.env.AZURE_EMBEDDING_DEPLOYMENT!,
  QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || 'facet_groups',
  REDIS_URL: process.env.REDIS_URL,
  CACHE_TTL_SECONDS: Number(process.env.CACHE_TTL_SECONDS || 300),
  CACHE_MEMORY_MAX_ITEMS: Number(process.env.CACHE_MEMORY_MAX_ITEMS || 1000)
};
