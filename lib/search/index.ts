import { Index } from "@upstash/vector";

/** One vector per highlight; `text` is embedded by the index's hosted model (ADR 0003). */
export type VectorDoc = {
  id: string;
  text: string;
  metadata: { user_id: string; entry_id: string; status: string; captured_at: string };
};

export type VectorHit = { id: string; score: number };

/** The only door to the vector index (docs/architecture.md). The index is derived and can be rebuilt. */
export interface VectorIndex {
  upsert(docs: VectorDoc[]): Promise<void>;
  remove(ids: string[]): Promise<void>;
  /** Best matches for `text` among this user's vectors, best first. */
  query(text: string, userId: string, topK: number): Promise<VectorHit[]>;
  /** Every vector id (and its owner) in the index, for the re-sync sweep. */
  listAll(): Promise<{ id: string; userId: string | null }[]>;
}

const BATCH = 100;

class UpstashVectorIndex implements VectorIndex {
  constructor(private readonly index: Index) {}

  async upsert(docs: VectorDoc[]): Promise<void> {
    for (let i = 0; i < docs.length; i += BATCH) {
      await this.index.upsert(docs.slice(i, i + BATCH).map((d) => ({ id: d.id, data: d.text, metadata: d.metadata })));
    }
  }

  async remove(ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += BATCH) await this.index.delete(ids.slice(i, i + BATCH));
  }

  async query(text: string, userId: string, topK: number): Promise<VectorHit[]> {
    const res = await this.index.query({
      data: text,
      topK,
      includeMetadata: false,
      filter: `user_id = '${userId.replace(/['\\]/g, "")}'`,
    });
    return res.map((r) => ({ id: String(r.id), score: r.score }));
  }

  async listAll() {
    const out: { id: string; userId: string | null }[] = [];
    let cursor: string | number = 0;
    for (;;) {
      const page: Awaited<ReturnType<Index["range"]>> = await this.index.range({ cursor, limit: 500, includeMetadata: true });
      for (const v of page.vectors) {
        const uid = (v.metadata as { user_id?: unknown } | undefined)?.user_id;
        out.push({ id: String(v.id), userId: typeof uid === "string" ? uid : null });
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return out;
  }
}

/** The Upstash index from the environment, or null when it isn't configured (local dev, tests). */
export function getVectorIndex(env: Record<string, string | undefined> = process.env): VectorIndex | null {
  const url = env.UPSTASH_VECTOR_REST_URL;
  const token = env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) return null;
  return new UpstashVectorIndex(new Index({ url, token }));
}

/** In-memory index for tests: "meaning" is word overlap. */
export class FakeVectorIndex implements VectorIndex {
  docs = new Map<string, VectorDoc>();
  failUpserts = false;
  async upsert(docs: VectorDoc[]) {
    if (this.failUpserts) throw new Error("upsert failed");
    for (const d of docs) this.docs.set(d.id, d);
  }
  async remove(ids: string[]) {
    for (const id of ids) this.docs.delete(id);
  }
  async query(text: string, userId: string, topK: number) {
    const words = new Set(text.toLowerCase().split(/\W+/).filter(Boolean));
    return [...this.docs.values()]
      .filter((d) => d.metadata.user_id === userId)
      .map((d) => ({ id: d.id, score: d.text.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length / (words.size || 1) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  async listAll() {
    return [...this.docs.values()].map((d) => ({ id: d.id, userId: d.metadata.user_id }));
  }
}
