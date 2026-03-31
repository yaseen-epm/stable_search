import { QdrantClient } from "@qdrant/js-client-rest";
import { EmbeddingService } from "./embedding.service";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

export class FacetVectorService {
  private client = new QdrantClient({ url: ENV.QDRANT_URL });
  private embeddingService = new EmbeddingService();

  private extractQ1(url: unknown): string | null {
    if (typeof url !== "string" || url.trim().length === 0) return null;

    try {
      const u = new URL(url, "http://local");
      const q1 = u.searchParams.get("q1");
      return (typeof q1 === "string" && q1.trim().length > 0) ? q1.trim() : null;
    } catch {
      return null;
    }
  }

  async getRelevantFacets(query: string) {
    const tAll = Date.now();
    try {
      const vector = await withTimeout(this.embeddingService.embed(query), 2500);
      if (!vector.length) return {};

      const tQ = Date.now();
      const result = await withTimeout(
        this.client.search(ENV.QDRANT_COLLECTION, {
          vector,
          limit: 20,
          with_payload: true
        }),
        2000
      );

      const qMs = Date.now() - tQ;
      const totalMs = Date.now() - tAll;
      console.log(
        `[perf] qdrant search ms=${qMs} total_ms=${totalMs} query_len=${query.length} collection=${ENV.QDRANT_COLLECTION}`
      );

      return this.groupFacets(Array.isArray(result) ? result : []);
    } catch (err: any) {
      const totalMs = Date.now() - tAll;
      console.log(`[perf] qdrant failed total_ms=${totalMs} query_len=${query.length}`);
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
      const facetType = p.type;
      const isRangeFacet = facetType === "range" || facetId === "pricerange";

      if (!grouped[facetId]) grouped[facetId] = [];

      // 🔥 extract values from facet group
      for (const v of p.values) {
        const fromUrl = isRangeFacet ? this.extractQ1(v?.url) : null;
        const fromLabel = (typeof v?.label === "string" && v.label.trim().length > 0)
          ? v.label.trim()
          : null;

        const chosen = fromUrl || fromLabel;
        if (!chosen) continue;

        grouped[facetId].push(chosen);
      }
    }

    // ✅ dedupe + limit
    Object.keys(grouped).forEach(facet => {
      grouped[facet] = [...new Set(grouped[facet])].slice(0, 5);
    });

    return grouped;
  }
}
