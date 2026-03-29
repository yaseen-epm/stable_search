import { SearchService3 } from "./services/search3.service";
import { SearchValidationError, validateAndNormalizeQuery } from "./utils/queryValidation";

export interface SearchStructuredResult {
  query: string;
  mapping: Record<string, string[]>;
}

export interface SearchResult {
  structured: SearchStructuredResult;
  ajaxQuery: string;
}

const defaultSearchService = new SearchService3();

export async function llmSearchQuery(query: unknown): Promise<SearchResult> {
  const normalizedQuery = validateAndNormalizeQuery(query);
  return defaultSearchService.search(normalizedQuery);
}

export { SearchService3, SearchValidationError, validateAndNormalizeQuery };