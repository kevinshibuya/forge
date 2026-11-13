import type { EmbeddingProvider } from './provider.interface';

/** Deterministic embeddings for tests: same text ⇒ same vector. */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embedding-001';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      let h = 2166136261;
      for (let i = 0; i < t.length; i += 1) { h = Math.imul(h ^ t.charCodeAt(i), 16777619); }
      const vec = new Array<number>(1536);
      let x = h >>> 0;
      for (let i = 0; i < 1536; i += 1) {
        x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
        vec[i] = (x / 0xffffffff) * 2 - 1;
      }
      const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
      return vec.map((v) => v / norm);
    });
  }
}
