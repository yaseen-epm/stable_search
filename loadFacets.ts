import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";
import { AzureOpenAI } from "openai";
import { ENV } from "./src/config/env";

/**
 * ============================
 * 🔧 CONFIG (EDIT HERE)
 * ============================
 */

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION_NAME = "demo_facets";

// Azure OpenAI
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY!;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT!;
const AZURE_API_VERSION = "2024-02-15-preview";
const EMBEDDING_DEPLOYMENT = process.env.AZURE_EMBEDDING_DEPLOYMENT!;

// JSON file path
const FILE_PATH = path.join(__dirname, "./facets.json");

/**
 * ============================
 * 🤖 Azure OpenAI Client
 * ============================
 */

// const openai = new AzureOpenAI({
//   apiKey: AZURE_OPENAI_KEY,
//   endpoint: AZURE_OPENAI_ENDPOINT,
//   apiVersion: AZURE_API_VERSION
// });

const openai = new AzureOpenAI({
  apiKey: ENV.AZURE_OPENAI_KEY,
  endpoint: ENV.AZURE_OPENAI_ENDPOINT,
  apiVersion: "2024-02-15-preview",
});

/**
 * ============================
 * 🧠 Embedding with cache
 * ============================
 */

const cache = new Map<string, number[]>();

async function getEmbedding(text: string): Promise<number[]> {
  const key = text.trim().toLowerCase();

  if (cache.has(key)) return cache.get(key)!;

  try {
    const res = await openai.embeddings.create({
      model: EMBEDDING_DEPLOYMENT,
      input: key,
    });

    const vector = res.data[0].embedding;

    cache.set(key, vector);

    return vector;
  } catch (err: any) {
    console.error("❌ Embedding error:", err.message);
    return [];
  }
}

/**
 * ============================
 * 📦 Qdrant Helpers
 * ============================
 */

// Check if collection exists
async function collectionExists(): Promise<boolean> {
  try {
    const res = await axios.get(`${QDRANT_URL}/collections`);
    return res.data.result.collections.some(
      (c: any) => c.name === COLLECTION_NAME,
    );
  } catch (err: any) {
    console.error("❌ Qdrant connection error:", err.message);
    return false;
  }
}

// Create collection
async function createCollection() {
  console.log("📦 Creating collection...");

  await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    vectors: {
      size: 1536,
      distance: "Cosine",
    },
  });

  console.log("✅ Collection created");
}

// Get existing facet signatures keyed by ID
async function getExistingFacetSignatures(): Promise<Map<string, string>> {
  const facetSignatures = new Map<string, string>();

  try {
    let offset: string | number | null = null;

    do {
      const res:any = await axios.post(
        `${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`,
        {
          limit: 1000,
          offset,
          with_payload: true,
          with_vector: false,
        },
      );

      const points = res.data.result.points ?? [];

      for (const point of points) {
        const id = String(point.id);
        const payload = point.payload ?? {};

        facetSignatures.set(id, normalizeFacetForComparison(payload));
      }

      offset = res.data.result.next_page_offset ?? null;
    } while (offset !== null);

    return facetSignatures;
  } catch (err: any) {
    console.warn("⚠️ No existing data or scroll failed");
    return new Map();
  }
}

// Insert points
async function upsert(points: any[]) {
  await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
    points,
  });
}

/**
 * ============================
 * 🔧 Utils
 * ============================
 */

function generateId(facet: any): string {
  const idSource =
    typeof facet?.id === "string" && facet.id.trim().length > 0
      ? facet.id.trim()
      : JSON.stringify({
          label: facet?.label ?? "",
          type: facet?.type ?? "",
          values: Array.isArray(facet?.values) ? facet.values : [],
        });

  return crypto.createHash("md5").update(idSource).digest("hex");
}

function buildEmbeddingText(facet: any): string {
  const values = facet.values
    .map((v: any) => `${v.label} (${v.count})`)
    .join(", ");

  return `
Facet: ${facet.label}
Type: ${facet.type}
Values: ${values}
  `;
}

function normalizeFacetForComparison(facet: any): string {
  return JSON.stringify({
    id: facet?.id ?? null,
    label: facet?.label ?? null,
    type: facet?.type ?? null,
    values: Array.isArray(facet?.values) ? facet.values : [],
  });
}

/**
 * ============================
 * 🚀 MAIN SCRIPT
 * ============================
 */

async function main() {
  try {
    console.log("🚀 Starting facet loader...\n");

    // 1️⃣ Ensure collection
    const exists = await collectionExists();

    if (!exists) {
      await createCollection();
    } else {
      console.log("✅ Collection already exists");
    }

    // 2️⃣ Read JSON
    const raw = fs.readFileSync(FILE_PATH, "utf-8");
    const facets = JSON.parse(raw);

    console.log(`📦 Loaded ${facets.length} facet groups\n`);

    // 3️⃣ Existing facet signatures
    const existingFacetSignatures = await getExistingFacetSignatures();
    console.log(`📦 existingIds: ${existingFacetSignatures.size}\n`);
    // 4️⃣ Prepare points
    const points = [];
    let newCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    let noValuesCount = 0;
    let embeddingFailedCount = 0;

    for (const facet of facets) {
      const id = generateId(facet);
      const currentSignature = normalizeFacetForComparison(facet);
      const existingSignature = existingFacetSignatures.get(id);

      if (existingSignature === currentSignature) {
        console.log(`⏭ Skipping (unchanged): ${facet.label}`);
          unchangedCount += 1;
        continue;
      }

      if (Array.isArray(facet.values) && facet.values.length > 0) {
        const text = buildEmbeddingText(facet);

        const vector = await getEmbedding(text);

          if (!vector.length) {
            embeddingFailedCount += 1;
            continue;
          }

        points.push({
          id,
          vector,
          payload: facet,
        });

        if (existingSignature) {
          console.log(`♻️ Prepared update: ${facet.label}`);
            updatedCount += 1;
        } else {
          console.log(`✅ Prepared new: ${facet.label}`);
            newCount += 1;
        }
      } else {
        console.log(`⚠️ Skipping (no values): ${facet.label}`);
          noValuesCount += 1;
      }
    }

    console.log("\n📊 Summary");
    console.log(`- New: ${newCount}`);
    console.log(`- Updated: ${updatedCount}`);
    console.log(`- Unchanged skipped: ${unchangedCount}`);
    console.log(`- No values skipped: ${noValuesCount}`);
    console.log(`- Embedding failed skipped: ${embeddingFailedCount}`);

    // 5️⃣ Insert
    if (points.length === 0) {
      console.log("\n✅ Nothing to insert");
      return;
    }

    await upsert(points);

    console.log(`\n🎉 Inserted ${points.length} facet groups`);
  } catch (err: any) {
    console.error("❌ Script failed:", err.message);
  }
}

main();
