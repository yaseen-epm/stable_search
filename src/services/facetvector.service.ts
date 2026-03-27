import { QdrantClient } from "@qdrant/js-client-rest";
import { EmbeddingService } from "./embedding.service";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

export class FacetVectorService {
  private client = new QdrantClient({ url: ENV.QDRANT_URL });
  private embeddingService = new EmbeddingService();

  async getRelevantFacets(query: string) {
    try {
      const vector = await withTimeout(this.embeddingService.embed(query), 2500);
      if (!vector.length) return {};

      const result = await withTimeout(
        this.client.search(ENV.QDRANT_COLLECTION, {
          vector,
          limit: 20,
          with_payload: true
        }),
        2000
      );

      return this.groupFacets(Array.isArray(result) ? result : []);
    } catch (err: any) {
      if (err?.status === 404) {
        console.warn("Qdrant collection not found");
        return {};
      }

      console.error("Qdrant error:", err?.message || err);
      return {};
    }
  }

  private groupFacets(results: any[]) {
    const grouped: Record<string, string[]> = {};

    for (const r of results) {
      const p = r.payload;
      if (!p?.id || !Array.isArray(p.values)) continue;

      const facetId = p.id;

      if (!grouped[facetId]) grouped[facetId] = [];

      // 🔥 extract values from facet group
      for (const v of p.values) {
        if (!v?.label) continue;

        grouped[facetId].push(v.label);
      }
    }

    // ✅ dedupe + limit
    Object.keys(grouped).forEach(facet => {
      grouped[facet] = [...new Set(grouped[facet])].slice(0, 5);
    });

    return grouped;
  }
}
