export class SearchValidationError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SearchValidationError";
    this.statusCode = statusCode;
  }
}

export function validateAndNormalizeQuery(query: unknown): string {
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new SearchValidationError("Query required");
  }

  const normalized = query.trim();

  if (normalized.length > 500) {
    throw new SearchValidationError("Query too long");
  }

  return normalized;
}