// src/services/embedding.service.ts
import { AzureOpenAI } from "openai";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

const client = new AzureOpenAI({
  apiKey: ENV.AZURE_OPENAI_KEY,
  endpoint: ENV.AZURE_OPENAI_ENDPOINT,
  apiVersion: "2024-02-15-preview"
});

const cache = new Map<string, number[]>();

const EMBEDDING_DEPLOYMENT = ENV.AZURE_EMBEDDING_DEPLOYMENT;
const TIMEOUT_MS = 25000;

export async function getEmbedding(text: string): Promise<number[]> {
  const key = text.toLowerCase().trim();

  if (cache.has(key)) {
    console.log(
      `[perf] embedding source=cache status=ok model=${EMBEDDING_DEPLOYMENT} key_len=${key.length}`
    );
    return cache.get(key)!;
  }

  try {
    const t0 = Date.now();
    const res = await withTimeout(
      client.embeddings.create({
        model: EMBEDDING_DEPLOYMENT,
        input: key
      }),
      TIMEOUT_MS
    );

    const ms = Date.now() - t0;
    console.log(
      `[perf] embedding source=remote status=ok model=${EMBEDDING_DEPLOYMENT} ms=${ms} timeout_ms=${TIMEOUT_MS} input_len=${key.length}`
    );

    const embedding = res.data[0].embedding;

    cache.set(key, embedding);

    return embedding;
  } catch (err: any) {
    const message = err?.message || String(err);
    console.log(
      `[perf] embedding source=remote status=error model=${EMBEDDING_DEPLOYMENT} timeout_ms=${TIMEOUT_MS} error=${message}`
    );
    return [];
  }
}

export class EmbeddingService {
  private client: AzureOpenAI;

  constructor() {
    this.client = new AzureOpenAI({
      apiKey: ENV.AZURE_OPENAI_KEY,
      endpoint: ENV.AZURE_OPENAI_ENDPOINT,
      apiVersion: "2024-02-15-preview"
    });
  }

  async embed(text: string): Promise<number[]> {
    try {
      const t0 = Date.now();
      const res = await withTimeout(
        this.client.embeddings.create({
          model: ENV.AZURE_EMBEDDING_DEPLOYMENT,
          input: text
        }),
        TIMEOUT_MS
      );

      const ms = Date.now() - t0;
      console.log(
        `[perf] embedding 1 source=remote status=ok model=${ENV.AZURE_EMBEDDING_DEPLOYMENT} ms=${ms} timeout_ms=${TIMEOUT_MS} input_len=${String(text).length}`
      );
      return res.data[0].embedding;
    } catch (err: any) {
      const message = err?.message || String(err);
      console.log(
        `[perf] embedding 1 source=remote status=error model=${ENV.AZURE_EMBEDDING_DEPLOYMENT} timeout_ms=${TIMEOUT_MS} error=${message}`
      );
      return [];
    }
  }
}
