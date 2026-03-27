import { AzureOpenAI } from "openai";
import { ENV } from "../config/env";
import { withTimeout } from "../utils/timeout";

export class LLMService {
  private client = new AzureOpenAI({
    apiKey: ENV.AZURE_OPENAI_KEY,
    endpoint: ENV.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview"
  });

  async generate(userQuery: string, facets: any) {
    const prompt = `
You are a STRICT e-commerce query parser.

RULES:
- ONLY use given facet ids
- DO NOT guess
- If unsure → return closed match mapping
- ALWAYS return SAME output for SAME input
- Prefer HIGH relevance facets only

User Query:
"${userQuery}"

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
        6000
      );

      const raw = res.choices?.[0]?.message?.content || "";

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
      console.error("LLM generate error:", err?.message || err);
      return { query: userQuery, filters: {}, mapping: {} };
    }
  }
}
