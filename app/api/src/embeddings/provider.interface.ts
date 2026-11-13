export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');
