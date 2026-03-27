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

export async function getEmbedding(text: string): Promise<number[]> {
  const key = text.toLowerCase().trim();

  if (cache.has(key)) return cache.get(key)!;

  try {
    const res = await withTimeout(
      client.embeddings.create({
        model: EMBEDDING_DEPLOYMENT,
        input: key
      }),
      2500
    );

    const embedding = res.data[0].embedding;

    cache.set(key, embedding);

    return embedding;
  } catch (err: any) {
    console.error("Embedding error:", err.message);
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
      const res = await withTimeout(
        this.client.embeddings.create({
          model: ENV.AZURE_EMBEDDING_DEPLOYMENT,
          input: text
        }),
        2500
      );
      return res.data[0].embedding;
    } catch (err: any) {
      console.error("Embedding error:", err?.message);
      return [];
    }
  }
}
