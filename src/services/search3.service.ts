import { FacetVectorService } from "./facetvector.service";
import { LLMService } from "./llm3.service";
import { cache } from "../utils/tieredCache";

type FacetMap = Record<string, { value: string; score: number }[]>;

export class SearchService3 {
  private facetService = new FacetVectorService();
  private llmService = new LLMService();

  async search(query: string) {
    const normalizedQuery = query.trim();
    const cacheKey = `search3:v1:${normalizedQuery.toLowerCase()}`;

    try {
      const cached = await cache.get<any>(cacheKey);
      if (cached) return cached;
    } catch {
      // best-effort cache
    }

    const queries = this.decompose(query).slice(0, 5);

    const facetResults = await Promise.all(
      queries.map(q => this.facetService.getRelevantFacets(q))
    );

    let mergedFacets: FacetMap = {};
    facetResults.forEach((facets: Record<string, string[]>, idx: number) => {
      const weight = idx === 0 ? 1 : 0.7; // main query > intent queries
      mergedFacets = this.merge(mergedFacets, facets, weight);
    });

    const finalFacets = this.flattenFacets(mergedFacets);

    if (Object.keys(finalFacets).length === 0) {
      const structured = { query: normalizedQuery, mapping: {} };
      const response = {
        structured,
        ajaxQuery: this.buildAjax(structured)
      };

      try {
        await cache.set(cacheKey, response);
      } catch {
        // best-effort cache
      }

      return response;
    }

    const structuredRaw = await this.llmService.generate(normalizedQuery, finalFacets);
    const structured = this.sanitizeStructured(structuredRaw, finalFacets, normalizedQuery);

    const response = {
      structured,
      ajaxQuery: this.buildAjax(structured)
    };

    try {
      await cache.set(cacheKey, response);
    } catch {
      // best-effort cache
    }

    return response;
  }

  private sanitizeStructured(
    data: any,
    allowedFacets: Record<string, string[]>,
    fallbackQuery: string
  ) {
    const query = typeof data?.query === "string" ? data.query : fallbackQuery;
    const mappingIn = data?.mapping && typeof data.mapping === "object" ? data.mapping : {};

    const mappingOut: Record<string, string[]> = {};
    const allowedFacetIds = new Set(Object.keys(allowedFacets));

    for (const [facetId, values] of Object.entries(mappingIn)) {
      if (!allowedFacetIds.has(facetId)) continue;

      const allowedValues = new Set((allowedFacets[facetId] || []).map(v => String(v).toLowerCase()));
      const list = Array.isArray(values) ? values : [values];
      const cleaned = list
        .map(v => String(v))
        .map(v => v.trim())
        .filter(v => v.length > 0)
        .filter(v => allowedValues.has(v.toLowerCase()))
        .slice(0, 5);

      if (cleaned.length) mappingOut[facetId] = cleaned;
      if (Object.keys(mappingOut).length >= 10) break;
    }

    return { query, mapping: mappingOut };
  }

  private decompose(query: string) {
    const intents = this.extractIntents(query);
    const base = this.cleanQuery(query);

    const queries: string[] = [];

    if (base) queries.push(base);

    if (intents.price) queries.push("low price");
    if (intents.rating) queries.push("high rating");
    if (intents.premium) queries.push("premium quality");
    if (intents.brand) queries.push("popular brand");

    return [...new Set(queries)];
  }

  private extractIntents(query: string) {
    const q = query.toLowerCase();

    return {
      price: /cheap|under|budget|low price/.test(q),
      rating: /best|top|quality|rating/.test(q),
      premium: /premium|luxury|high end/.test(q),
      brand: /nike|bosch|adidas|puma/.test(q)
    };
  }

  private cleanQuery(query: string) {
    return query
      .replace(/cheap|best|top|quality|under|budget|premium|luxury/gi, "")
      .trim();
  }

  private merge(
    base: FacetMap,
    incoming: Record<string, string[]>,
    weight: number
  ): FacetMap {
    for (const facet in incoming) {
      if (!base[facet]) base[facet] = [];

      for (const value of incoming[facet]) {
        const existing = base[facet].find(v => v.value === value);

        if (existing) {
          existing.score += weight;
        } else {
          base[facet].push({ value, score: weight });
        }
      }
    }

    return base;
  }

  private flattenFacets(facets: FacetMap) {
    const result: Record<string, string[]> = {};

    for (const facet in facets) {
      result[facet] = facets[facet]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(v => v.value);
    }

    return result;
  }

  private buildAjax(data: any) {
    let url = `?q=${encodeURIComponent(data.query)}`;

    if (data.mapping) {
      Object.entries(data.mapping).forEach(([k, v]: any, i) => {
        url += `&x${i + 1}=${k}&q${i + 1}=${encodeURIComponent(v.join(","))}`;
      });
    }

    return url;
  }
}
