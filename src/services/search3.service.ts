import { FacetVectorService } from "./facetvector.service";
import { LLMService } from "./llm3.service";
import { cache } from "../utils/tieredCache";

type FacetMap = Record<string, { value: string; score: number }[]>;

export class SearchService3 {
  private facetService = new FacetVectorService();
  private llmService = new LLMService();

  async search(query: string, providedFilters?: unknown) {
    const tAll = Date.now();
    const normalizedQuery = query.trim();
    const parsedFilters = this.parseFilters(providedFilters);
    const filtersKey = this.filtersCacheKey(parsedFilters);
    const cacheKey = `search3:v1:${normalizedQuery.toLowerCase()}:${filtersKey}`;

    try {
      const tCache = Date.now();
      const cached = await cache.get<any>(cacheKey);
      const cacheMs = Date.now() - tCache;
      if (cached) return cached;
      console.log(
        `[perf] op=search cache=miss status=ok ms=${cacheMs} key_len=${cacheKey.length} query_len=${normalizedQuery.length} filters=${Object.keys(parsedFilters).length}`
      );
    } catch {
      // best-effort cache
    }

    const queries = this.decompose(query).slice(0, 5);

    const tFacets = Date.now();
    const facetResults = await Promise.all(
      queries.map(q => this.facetService.getRelevantFacets(q))
    );
    const facetsMs = Date.now() - tFacets;
    console.log(
      `[perf] op=facet_candidates source=qdrant status=ok ms=${facetsMs} subqueries=${queries.length} query_len=${normalizedQuery.length}`
    );

    let mergedFacets: FacetMap = {};
    facetResults.forEach((facets: Record<string, string[]>, idx: number) => {
      const weight = idx === 0 ? 1 : 0.7; // main query > intent queries
      mergedFacets = this.merge(mergedFacets, facets, weight);
    });

    const finalFacets = this.flattenFacets(mergedFacets);

    if (Object.keys(finalFacets).length === 0) {
      const structured = {
        query: normalizedQuery,
        mapping: this.mergeProvidedFilters({}, parsedFilters, {})
      };
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

    const tLlm = Date.now();
    const structuredRaw = await this.llmService.generate(normalizedQuery, finalFacets, parsedFilters);
    const llmMs = Date.now() - tLlm;
    console.log(
      `[perf] op=llm_total status=ok ms=${llmMs} query_len=${normalizedQuery.length} facets=${Object.keys(finalFacets).length} provided_filters=${Object.keys(parsedFilters).length}`
    );
    const structuredBase = this.sanitizeStructured(structuredRaw, finalFacets, normalizedQuery);
    const structured = {
      query: structuredBase.query,
      mapping: this.mergeProvidedFilters(structuredBase.mapping, parsedFilters, finalFacets)
    };

    const response = {
      structured,
      ajaxQuery: this.buildAjax(structured)
    };

    try {
      await cache.set(cacheKey, response);
    } catch {
      // best-effort cache
    }

    const totalMs = Date.now() - tAll;
    console.log(
      `[perf] op=search_response status=ok total_ms=${totalMs} query_len=${normalizedQuery.length} facets=${Object.keys(finalFacets).length} provided_filters=${Object.keys(parsedFilters).length}`
    );
    return response;
  }

  private filtersCacheKey(filters: Record<string, string[]>) {
    const keys = Object.keys(filters).sort();
    if (keys.length === 0) return "nofilters";

    return keys
      .map(k => `${k}=${(filters[k] || []).slice().sort().join("|")}`)
      .join("&");
  }

  private normalizeFilterValue(raw: unknown): string | null {
    if (typeof raw !== "string") return null;

    let v = raw.trim();
    if (v.length === 0) return null;

    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1).trim();
    }

    try {
      v = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      v = v.replace(/\+/g, " ");
    }

    v = v.trim();
    return v.length ? v : null;
  }

  private parseFilters(input: unknown): Record<string, string[]> {
    if (!input || typeof input !== "object") return {};

    const out: Record<string, string[]> = {};
    for (const [facetIdRaw, rawVal] of Object.entries(input as Record<string, unknown>)) {
      const facetId = String(facetIdRaw).trim();
      if (!facetId) continue;

      const values: string[] = [];

      if (Array.isArray(rawVal)) {
        for (const item of rawVal) {
          const n = this.normalizeFilterValue(item);
          if (n) values.push(n);
        }
      } else if (typeof rawVal === "string") {
        rawVal.split("|").forEach(part => {
          const n = this.normalizeFilterValue(part);
          if (n) values.push(n);
        });
      } else {
        const n = this.normalizeFilterValue(rawVal);
        if (n) values.push(n);
      }

      const deduped = [...new Set(values)].slice(0, 25);
      if (deduped.length) out[facetId] = deduped;
      if (Object.keys(out).length >= 25) break;
    }

    return out;
  }

  private mergeProvidedFilters(
    mapping: Record<string, string[]>,
    provided: Record<string, string[]>,
    allowedFacets: Record<string, string[]>
  ) {
    if (!provided || Object.keys(provided).length === 0) return mapping;

    // Precedence rule: mapping (LLM/user query) wins when the same facetId exists.
    const out: Record<string, string[]> = { ...mapping };

    for (const [facetId, values] of Object.entries(provided)) {
      if (out[facetId] && out[facetId].length > 0) continue;

      const list = Array.isArray(values) ? values : [];
      if (!list.length) continue;

      const allowed = allowedFacets[facetId];

      const cleaned = allowed
        ? list
            .map(v => String(v).trim())
            .filter(v => v.length > 0)
            .filter(v => new Set(allowed.map(a => String(a).toLowerCase())).has(v.toLowerCase()))
            .slice(0, 20)
        : list
            .map(v => String(v).trim())
            .filter(v => v.length > 0)
            .slice(0, 20);

      if (cleaned.length) out[facetId] = cleaned;
    }

    return out;
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
