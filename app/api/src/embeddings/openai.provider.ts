import { z } from 'zod';
import type { EmbeddingProvider } from './provider.interface';

const ResponseSchema = z.object({
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
});

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  constructor(
    readonly model = 'text-embedding-3-small',
    private readonly apiKey = process.env.OPENAI_API_KEY ?? '',
    private readonly baseUrl = 'https://api.openai.com/v1',
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY is not set (required for embeddings only)');
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${await res.text()}`);
    const parsed = ResponseSchema.parse(await res.json());
    return parsed.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
