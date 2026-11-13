# R2. Embedding model for short bilingual social text, and reranking at small scale

Research note for the forge v2 brief (research contract R2). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable). [vendor] marks a vendor's claim about its
own product.

## Verdict

On the one independent Brazilian Portuguese benchmark, gemini-embedding-001, Qwen3-Embedding-8B and
voyage-context-4 lead and OpenAI text-embedding-3-large trails by about 0.04 mean score, with
text-embedding-3-small (forge's current model) around 15th. Nobody has measured any of them on
50-to-500-item corpora of social posts, and no published ablation shows a reranker helping at a pool of
about 50 and k of 3 to 8. A paired in-house eval on forge's own corpus decides the model; reranking is
out of v1 on absence of evidence and presence of latency.

## Evidence

1. MTEB-BR (93 models, 22 PT-BR tasks, including a social-media domain), mean scores:
   gemini-embedding-001 0.682 (rank 1), Qwen3-Embedding-8B 0.670, KaLM-Gemma3-12B 0.670,
   voyage-context-4 0.668, text-embedding-3-large 0.645; text-embedding-3-small about 15th, score not
   extracted; gemini-embedding-2 lower at 0.633. Top STS (ASSIN/ASSIN2) about 0.80 to 0.83.
   [https://arxiv.org/html/2607.04581v2, 2026-07]
2. MTEB-PT (14 MMTEB datasets): search-oriented multilingual encoders (qwen3-embedding-0.6b, stronger
   E5 variants, gte-multilingual-base) beat Portuguese models built for STS.
   [https://arxiv.org/html/2607.04071v2, 2026-07]
3. Qwen3-Embedding-0.6B: about 67.7 on MMTEB, the best multilingual model under 1B parameters.
   [https://arxiv.org/pdf/2506.05176, 2025-06]
4. voyage-3.5 $0.06 per 1M tokens, voyage-3.5-lite $0.02; Matryoshka 2048/1024/512/256 dims; float,
   int8, binary. Voyage claims +8.26% and +6.34% over OpenAI v3-large on its own suite [vendor].
   [https://blog.voyageai.com/2025/05/20/voyage-3-5/, 2025-05-20]
5. voyage-context-4 builds each chunk's vector from chunk plus whole document; claims about +1.4% over
   context-3 and +8.4% over Cohere v4 on chunk retrieval [vendor]. When a document is one chunk there
   is no extra context to add, so any gain comes from the base model; no single-chunk ablation found.
   [https://blog.voyageai.com/2026/06/29/voyage-context-4/, 2026-06-29]
6. gemini-embedding-001: $0.15 per 1M tokens, 2,048 input tokens, 3072 dims default with Matryoshka
   truncation to 1536 or 768 (price confirmed only via aggregators).
   [https://developers.googleblog.com/gemini-embedding-available-gemini-api/, 2025-07]
7. Cohere embed-v4: $0.12 per 1M tokens, 128K context, 1536 dims; not in MTEB-BR's top 30 as found.
   [https://embeddingcost.com/cohere, aggregator, 2026]
8. Reranking: a recsys study found smaller candidate pools beat larger ones (noise); a RAG study found
   NDCG@10 rising with rerank depth and settled on k=20. Neither tests exemplar picking at a pool of 50.
   [https://arxiv.org/pdf/2604.16318, 2026-04; https://arxiv.org/pdf/2506.07116, 2025]

## What was measured, by whom, on what data

MTEB-BR and MTEB-PT: academic groups, public PT-BR datasets (legal, medical, science, encyclopedia,
social media), aggregate means; English not measured there; an author's own stylistic similarity not
measured anywhere. Voyage's percentages are its own suites. The rerank papers are large-corpus QA and
recsys.

## Reading

The switch cost is small: at most a few hundred items per Voice to re-embed. The switch benefit on
PT-BR is real on the benchmark and unmeasured on forge's task. gemini-embedding-001 truncated to 1536
fits the existing `vector(1536)` column, which makes it the cheapest candidate to trial; voyage-3.5 at
1024 is the cheapest per token and would change the column. voyage-context-4's contextualized trick,
the piece of the reference RAG project Kevin named, buys nothing when a post is one chunk (R1 settles that posts are
one chunk), so its appeal here rests on its base-model score alone, which is third on PT-BR.

## Decision fed

- Embedding provider ADR: run the paired eval R17 describes (held-out ideas, recall@5 against the
  exemplars the author would pick, plus downstream judge win-rate) on text-embedding-3-small,
  gemini-embedding-001 @1536 and voyage-3.5 @1024; ship the winner; the ADR records the numbers.
- Rerank step: none in v1. Reopen only if the eval shows exemplar quality is the limiting factor.
- Multilingual requirement: whichever model ships must be one model for both languages so a Voice's
  corpus and a query embed in the same space.

## Open items

- OpenAI prices ($0.02 and $0.13 per 1M, from memory) and all rate limits unverified.
- text-embedding-3-small, BGE-M3, multilingual-e5 and Cohere scores in MTEB-BR not extracted.
- Voyage rerank-2.5 and Cohere rerank-3.5 on short PT-BR text: not established.
- Quality on 300-to-3,000-character LinkedIn-style posts: not established.

## Confidence

Medium. One large independent benchmark carries the PT-BR ranking; fitness for the task and the value
of reranking at this scale are unmeasured.
