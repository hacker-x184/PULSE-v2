/**
 * PULSE Real Embedding & Vector Retrieval Engine
 * Uses local Xenova all-MiniLM-L6-v2 transformer model (384-dimensional dense vectors)
 * Combined with SQLite persistence and Cosine Similarity + BM25 Hybrid Search.
 */

let pipelineInstance: any = null;
let isInitializingPipeline = false;
let initPipelinePromise: Promise<any> | null = null;

async function getExtractorPipeline() {
  if (pipelineInstance) return pipelineInstance;
  if (initPipelinePromise) return initPipelinePromise;

  initPipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      // Configure local cache directory if needed
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true
      });
      pipelineInstance = extractor;
      return extractor;
    } catch (err: any) {
      console.warn('Failed to load local transformers embedding model:', err.message);
      return null;
    } finally {
      initPipelinePromise = null;
    }
  })();

  return initPipelinePromise;
}

/**
 * Computes a real 384-dimensional dense vector embedding using all-MiniLM-L6-v2.
 * Returns null if the embedding model cannot be initialized.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text || !text.trim()) return null;

  try {
    const extractor = await getExtractorPipeline();
    if (!extractor) return null;

    // Truncate to reasonable token length (512 tokens max for MiniLM)
    const cleanText = text.slice(0, 2000).replace(/\s+/g, ' ').trim();
    const output = await extractor(cleanText, { pooling: 'mean', normalize: true });

    if (output && output.data) {
      // Float32Array to number[]
      const vector: number[] = Array.from(output.data);
      return vector;
    }
  } catch (err: any) {
    console.warn('Embedding generation error:', err.message);
  }

  return null;
}

/**
 * Calculates exact cosine similarity between two dense normalized vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  // If normalized, dot product is cosine similarity [-1, 1], normalize to [0, 1]
  return Math.max(0, Math.min(1, (dot + 1) / 2));
}

/**
 * BM25 lexical relevance score calculation.
 */
export function computeBM25Score(queryTokens: string[], docText: string, avgDocLen = 80): number {
  if (!queryTokens.length || !docText) return 0;
  const docTokens = docText.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2);
  if (!docTokens.length) return 0;

  const freq: Record<string, number> = {};
  for (const t of docTokens) {
    freq[t] = (freq[t] || 0) + 1;
  }

  const k1 = 1.2;
  const b = 0.75;
  let score = 0;
  const unique = Array.from(new Set(queryTokens));

  for (const term of unique) {
    const tf = freq[term] || 0;
    if (tf > 0) {
      const num = tf * (k1 + 1);
      const den = tf + k1 * (1 - b + b * (docTokens.length / avgDocLen));
      score += num / den;
    }
  }

  return Math.min(1, score / (unique.length * 1.5));
}
