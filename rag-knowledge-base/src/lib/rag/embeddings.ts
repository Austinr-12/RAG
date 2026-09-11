import { getOpenAIClient } from "@/lib/openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const BATCH_SIZE = 100;
// Why: batches used to run serially — a 500-chunk upload was 5 sequential
// round-trips (~20s of wall clock). A small worker pool overlaps them without
// hammering the API from one request. Transient 429/5xx are retried by the
// OpenAI SDK itself (2 retries with backoff by default), so no retry logic
// lives here.
const MAX_CONCURRENT_BATCHES = 4;

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedBatch([text]);
  return vector;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const out: number[][] = new Array(texts.length);
  const starts: number[] = [];
  for (let s = 0; s < texts.length; s += BATCH_SIZE) starts.push(s);

  // Why: worker-pool over Promise.all(chunks) so at most N requests are in
  // flight regardless of file size. `next++` is safe — single-threaded, no
  // await between read and increment.
  let next = 0;
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENT_BATCHES, starts.length) },
    async () => {
      while (next < starts.length) {
        const start = starts[next++];
        const slice = texts.slice(start, start + BATCH_SIZE);
        const res = await getOpenAIClient().embeddings.create({
          model: EMBEDDING_MODEL,
          input: slice,
        });
        for (const item of res.data) {
          out[start + item.index] = item.embedding;
        }
      }
    },
  );
  await Promise.all(workers);

  return out;
}
