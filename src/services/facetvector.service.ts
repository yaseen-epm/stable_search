import { QdrantClient } from "@qdrant/js-client-rest";
import { EmbeddingService } from "./embedding.service";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

export class FacetVectorService {
  private client = new QdrantClient({ url: ENV.QDRANT_URL });
  private embeddingService = new EmbeddingService();

  private static readonly EMBED_TIMEOUT_MS = 25000;
  private static readonly QDRANT_TIMEOUT_MS = 20000;

  private extractUrlParam(url: unknown, param: string): string | null {
    if (typeof url !== "string" || url.trim().length === 0) return null;

    try {
      const u = new URL(url, "http://local");
      const value = u.searchParams.get(param);
      return (typeof value === "string" && value.trim().length > 0) ? value.trim() : null;
    } catch {
      return null;
    }
  }

  async getRelevantFacets(query: string) {
    const tAll = Date.now();
    try {
      const tEmbed = Date.now();
      const vector = await withTimeout(
        this.embeddingService.embed(query),
        FacetVectorService.EMBED_TIMEOUT_MS
      );
      const embedMs = Date.now() - tEmbed;
      if (!vector.length) return {};

      const tQ = Date.now();
      const result = await withTimeout(
        this.client.search(ENV.QDRANT_COLLECTION, {
          vector,
          limit: 20,
          with_payload: true
        }),
        FacetVectorService.QDRANT_TIMEOUT_MS
      );

      const qMs = Date.now() - tQ;
      const totalMs = Date.now() - tAll;
      console.log(
        `[perf] op=facetvector status=ok embed_ms=${embedMs} qdrant_ms=${qMs} total_ms=${totalMs} embed_timeout_ms=${FacetVectorService.EMBED_TIMEOUT_MS} qdrant_timeout_ms=${FacetVectorService.QDRANT_TIMEOUT_MS} query_len=${query.length} collection=${ENV.QDRANT_COLLECTION}`
      );

      return this.groupFacets(Array.isArray(result) ? result : []);
    } catch (err: any) {
      const totalMs = Date.now() - tAll;
      const message = err?.message || String(err);
      console.log(
        `[perf] op=facetvector status=error total_ms=${totalMs} embed_timeout_ms=${FacetVectorService.EMBED_TIMEOUT_MS} qdrant_timeout_ms=${FacetVectorService.QDRANT_TIMEOUT_MS} query_len=${query.length} collection=${ENV.QDRANT_COLLECTION} error=${message}`
      );
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

      // 🔥 extract values from facet group
      for (const v of p.values) {
         // p.url looks like - "url": "?store=600&x1=ast-id-level-2&q1=DC0002124"
         // We want to extract the value of the "q1" parameter from the URL and key (currently facetid) from x1 parameter always
        const groupedKey = this.extractUrlParam(v?.url, "x1");
        const groupedValue = this.extractUrlParam(v?.url, "q1");
        if (!groupedKey || !groupedValue) continue;

        if (!grouped[groupedKey]) grouped[groupedKey] = [];
        grouped[groupedKey].push(groupedValue);
      }
    } 

    // ✅ dedupe + limit
    Object.keys(grouped).forEach(facet => {
      grouped[facet] = [...new Set(grouped[facet])].slice(0, 25);
    });

    return grouped;
  }
}
