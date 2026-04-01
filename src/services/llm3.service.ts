import { AzureOpenAI } from "openai";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

export class LLMService {
  private client = new AzureOpenAI({
    apiKey: ENV.AZURE_OPENAI_KEY,
    endpoint: ENV.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview"
  });

  private static readonly TIMEOUT_MS = 6000;

  async generate(userQuery: string, facets: any, providedFilters?: any) {
    const t0 = Date.now();
    const prompt = `
You are a STRICT e-commerce query parser.

RULES:
- ONLY use given facet ids
- DO NOT guess
- If unsure → return closed match mapping
- ALWAYS return SAME output for SAME input
- Prefer HIGH relevance facets only
- If user query conflicts with provided filters, user query wins
- Provided filters are optional hints / preselected filters

User Query:
"${userQuery}"

Provided Filters (optional):
${JSON.stringify(providedFilters || {})}

Facets:
${JSON.stringify(facets)}

Return JSON:
{
  "query": "...",
  "mapping": {
    "<facet.id>": ["value"]
  }
}
`;

    try {
      const res = await withTimeout(
        this.client.chat.completions.create({
          model: ENV.AZURE_DEPLOYMENT,
          messages: [{ role: "user", content: prompt }],
          temperature: 0
        }),
        LLMService.TIMEOUT_MS
      );

      const raw = res.choices?.[0]?.message?.content || "";
      const ms = Date.now() - t0;
      console.log(
        `[perf] op=llm_generate status=ok model=${ENV.AZURE_DEPLOYMENT} ms=${ms} timeout_ms=${LLMService.TIMEOUT_MS} query_len=${userQuery.length} facets=${Object.keys(facets || {}).length} provided_filters=${Object.keys(providedFilters || {}).length} raw_len=${raw.length}`
      );

      try {
        return JSON.parse(raw);
      } catch {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return JSON.parse(match[0]);
          } catch {
            return { query: userQuery, filters: {}, mapping: {} };
          }
        }
        return { query: userQuery, filters: {}, mapping: {} };
      }
    } catch (err: any) {
      const ms = Date.now() - t0;
      const message = err?.message || String(err);
      console.log(
        `[perf] op=llm_generate status=error model=${ENV.AZURE_DEPLOYMENT} ms=${ms} timeout_ms=${LLMService.TIMEOUT_MS} query_len=${userQuery.length} facets=${Object.keys(facets || {}).length} provided_filters=${Object.keys(providedFilters || {}).length} error=${message}`
      );
      console.error("LLM generate error:", err?.message || err);
      return { query: userQuery, filters: {}, mapping: {} };
    }
  }
}
