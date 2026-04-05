# search_stable (hackathon)

Express + TypeScript service for converting a free-text e-commerce search query into a **structured facet mapping** and a **compatible AJAX query string**.

The package can now be used in two modes:
 

 
- Library mode: install `llm-search-lib` and call `search(query)` directly.
- Server mode: run the Express endpoint (`POST /search`) as before.


## 🏗️ E-commerce AI Search Architecture

```mermaid
flowchart LR

A[Frontend UI] -->|Search Query| B[Backend API /search]

B -->|Call AI Search Library| C[Search Orchestrator]

C --> D[LLM Query Understanding]
D --> E[Sanitize & Allowlist]
E --> C

C --> F[In-Memory Cache L1]
C --> G[Redis Cache L2]

C --> H[Embedding Generator]
H --> I[Vector DB Qdrant]
I --> J[Candidate Retrieval]
J --> C

C --> K[Structured Query Response]
K --> B
B -->|Final Response| A


## Architecture (block diagram)

```mermaid
flowchart LR
  subgraph Client["Client"]
    U["User / Frontend"]
  end

  subgraph API["Express API"]
    R["POST /search<br/>(src/index.ts)"]
    C["Controller<br/>(search3.controller.ts)"]
    S["SearchService3<br/>(search3.service.ts)"]
  end

  subgraph Cache["Cache (Tiered)"]
    M["In-memory Map<br/>(L1)"]
    D["Redis<br/>(L2 - optional)"]
  end

  subgraph Retrieval["Facet Retrieval"]
    E["Embeddings<br/>(Azure OpenAI)"]
    Q["Qdrant Vector Search<br/>(facet_groups)"]
    F["Candidate facets + values"]
  end

  subgraph LLM["LLM Mapping"]
    L["Azure OpenAI Chat<br/>(temperature=0)"]
    Z["Sanitize + Allowlist<br/>(known facet ids/values)"]
  end

  subgraph Output["Response"]
    O1["structured<br/>{ query, mapping }"]
    O2["ajaxQuery<br/>?q=...&x1=...&q1=..."]
  end

  U --> R --> C --> S
  S <--> M
  S <--> D
  S --> E --> Q --> F
  S --> L --> Z
  F --> S
  Z --> S
  S --> O1
  S --> O2

  classDef client fill:#DBEAFE,stroke:#2563EB,stroke-width:2px,color:#0B1220;
  classDef api fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#0B1220;
  classDef cache fill:#FEF3C7,stroke:#D97706,stroke-width:2px,color:#0B1220;
  classDef retrieval fill:#FCE7F3,stroke:#DB2777,stroke-width:2px,color:#0B1220;
  classDef llm fill:#EDE9FE,stroke:#7C3AED,stroke-width:2px,color:#0B1220;
  classDef out fill:#E0F2FE,stroke:#0284C7,stroke-width:2px,color:#0B1220;

  class U client;
  class R,C,S api;
  class M,D cache;
  class E,Q,F retrieval;
  class L,Z llm;
  class O1,O2 out;
```

It uses:

- Azure OpenAI Embeddings to embed the query
- Qdrant (vector DB) to retrieve the most relevant facet groups/values
- Azure OpenAI Chat Completions to produce a deterministic JSON mapping (temperature `0`)
- Optional Redis + in-memory cache for faster repeat queries

---

## What this service returns

For an input query like:

- `"cheap nike running shoes under 200"`

The service attempts to return:

- A `structured` JSON payload:
  - `query`: canonical query string to search
  - `mapping`: facet-id => selected facet values
- An `ajaxQuery` string shaped for a downstream system:
  - `?q=<query>&x1=<facetId>&q1=<comma,separated,values>...`

If no relevant facets are found, it returns an empty mapping and only the query.

---

## API

### `POST /search`

- **Port**: `3000`
- **Content-Type**: `application/json`
- **Body**:

```json
{ "query": "string" }
```

- **Validation**:
  - `query` must be a non-empty string
  - max length: `500`

- **Response**:

```json
{
  "success": true,
  "structured": {
    "query": "...",
    "mapping": {
      "<facet.id>": ["value1", "value2"]
    }
  },
  "ajaxQuery": "?q=...&x1=...&q1=..."
}
```

Example:

```bash
curl -s \
  -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"cheap nike running shoes"}' | jq
```

---

## Library usage (npm)

Install in another service:

```bash
npm install llm-search-lib
```

Use the convenience function:

```ts
import { search } from "llm-search-lib";

const result = await search("cheap nike running shoes");
console.log(result.structured);
console.log(result.ajaxQuery);
```

Or use the class API:

```ts
import { SearchService3, validateAndNormalizeQuery } from "llm-search-lib";

const service = new SearchService3();
const query = validateAndNormalizeQuery("cheap nike running shoes");
const result = await service.search(query);
```

Optional server import from package subpath:

```ts
import { createApp } from "llm-search-lib/server";

const app = createApp();
app.listen(3000);
```

---

## Quick start

### 1) Install

```bash
npm install
```

### 2) Create `.env`

Create a `.env` file in the repo root (same level as `package.json`). Required variables are listed below.

### 3) Run Qdrant

You need a Qdrant instance reachable at `QDRANT_URL`.

If you already have Qdrant running somewhere, set `QDRANT_URL` accordingly.

### 4) Load facets into Qdrant (one-time / whenever facets change)

This repo includes a loader that reads `facets.json`, builds embeddings, and upserts facet groups into Qdrant.

```bash
npx ts-node loadFacets.ts
```

Notes:

- The loader creates a collection named `facet_groups` (hardcoded in `loadFacets.ts`).
- The API service defaults `ENV.QDRANT_COLLECTION` to `facet_groups`.

### 5) Start the API

Dev mode (auto-reload):

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

---

## Environment variables

Defined in `src/config/env.ts`.

### Required

- `AZURE_OPENAI_KEY`
  - Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT`
  - Azure OpenAI resource endpoint, e.g. `https://<resource>.openai.azure.com/`
- `AZURE_DEPLOYMENT`
  - Chat/completions deployment name (used by `LLMService`)
- `AZURE_EMBEDDING_DEPLOYMENT`
  - Embeddings deployment name (used by `EmbeddingService` and facet loader)
- `QDRANT_URL`
  - Base URL of Qdrant, e.g. `http://localhost:6333`

### Optional

- `QDRANT_COLLECTION`
  - Defaults to `facet_groups`
- `REDIS_URL`
  - If unset, caching becomes in-memory only (no Redis)
- `CACHE_TTL_SECONDS`
  - Defaults to `300`
- `CACHE_MEMORY_MAX_ITEMS`
  - Defaults to `1000`

---

## Architecture

### High-level components

- **Express API** (`src/index.ts`)
  - Single endpoint: `POST /search`
  - Adds `requestLogger` middleware to print request/response timing

- **Controller** (`src/controllers/search3.controller.ts`)
  - Validates input
  - Calls `SearchService3.search(query)`

- **Search pipeline** (`src/services/search3.service.ts`)
  - Handles caching
  - Decomposes query into a few intent-like subqueries
  - Fetches relevant facets from Qdrant for each subquery
  - Merges and ranks facets
  - Calls LLM to map query -> facet values
  - Sanitizes LLM output (only allow known facet ids/values)
  - Builds a downstream `ajaxQuery` string

- **Facet retrieval** (`src/services/facetvector.service.ts`)
  - Embeds text via Azure embeddings
  - Queries Qdrant collection with cosine similarity
  - Converts Qdrant payloads into `{ facetId: [values...] }`

- **LLM mapping** (`src/services/llm3.service.ts`)
  - Azure OpenAI Chat Completion
  - `temperature: 0` to encourage deterministic output
  - Attempts to parse JSON; falls back to safe empty mapping

- **Tiered cache** (`src/utils/tieredCache.ts`)
  - L1: in-memory `Map` with TTL + max-size eviction
  - L2: Redis `GET`/`SETEX` (if `REDIS_URL` is configured)
  - Cache key used by search: `search3:v1:<normalized query>`

- **Facet loader** (`loadFacets.ts`)
  - Reads `facets.json`
  - Builds an embedding text representation per facet group
  - Creates Qdrant collection if missing
  - Upserts points with payload containing the original facet structure

---

## Data flow (request-time)

1. Client calls `POST /search` with `{ query }`.
2. `SearchService3` checks tiered cache.
3. If not cached:
   1. The query is decomposed into a small set of related subqueries (base query + simple intent probes).
   2. For each subquery:
      - Embed via Azure embeddings
      - Vector-search Qdrant for facet groups
      - Extract facet ids and candidate values from Qdrant payloads
   3. Facets are merged and scored across subqueries.
   4. If no facets found:
      - Return `{ query, mapping: {} }` + `ajaxQuery`.
   5. Otherwise:
      - Call Azure chat completion to produce a JSON mapping.
      - Sanitize:
        - Drop unknown facet ids
        - Drop values not present in the allowed facet values
        - Enforce small limits (values per facet and number of facets)
      - Build `ajaxQuery` string.
4. Store the response back into cache (best-effort).

---

## Qdrant payload expectations

The request-time facet extractor expects each Qdrant search result payload to look like:

- `payload.id` (facet id)
- `payload.values` (array)
- Each value has a `label`

`facetvector.service.ts` extracts `payload.values[*].label` and returns up to 5 unique labels per facet.

---

## Operational notes

- **Timeouts**: embedding and Qdrant calls are wrapped with `withTimeout(...)`.
  - Embeddings: ~2.5s
  - Qdrant search: ~2.0s
  - LLM generation: ~6.0s

- **Redis is optional**: if `REDIS_URL` is not set, cache calls become no-ops for Redis and still use in-memory caching.

- **Determinism**:
  - LLM calls use `temperature: 0`.
  - `SearchService3.sanitizeStructured(...)` enforces that only known facet ids/values can be returned.

---

## Troubleshooting

### Qdrant collection not found

If you see `Qdrant collection not found`, run:

```bash
npx ts-node loadFacets.ts
```

(or ensure `QDRANT_COLLECTION` matches what you created.)

### LLM returns invalid JSON

The service attempts to extract a JSON object from the response content. If parsing fails, it falls back to:

- `{ query: <original>, mapping: {} }`

### Redis connection issues

If Redis is misconfigured/unreachable, the service logs errors and continues (cache is best-effort).

---

## Repo layout

- `src/index.ts` - Express app + routes
- `src/controllers/` - HTTP handlers
- `src/services/` - search pipeline + external service clients
- `src/utils/` - caching, Redis client, timeouts, request logging
- `src/config/env.ts` - dotenv + env var mapping
- `facets.json` - facet groups used to populate Qdrant
- `loadFacets.ts` - facet ingestion script
