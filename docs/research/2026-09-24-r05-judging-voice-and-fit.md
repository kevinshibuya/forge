# R5. Judging voice fidelity and platform fit

Research note for the forge v2 brief (research contract R5). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable).

## Verdict

No published judge or embedding has been validated against a human's "sounds like me" on
LinkedIn-style posts, in English or Portuguese. The defensible design: a reference-based fidelity score
from a style embedding, shown next to two calibrated floors computed from the same corpus (the author's
held-out posts against the corpus; other authors' posts against it), plus a pairwise LLM judge run
twice with swapped order. Platform fit is a deterministic contract check plus a short rubric judge;
nothing better was found.

## Evidence

1. MT-Bench / Chatbot Arena: a strong judge agrees with human preference above 80%, about the
   human-human rate; position, verbosity and self-enhancement biases named; fix is two calls with
   swapped order, a win only when both agree. [https://arxiv.org/abs/2306.05685, 2023]
2. Prometheus 2 (open 7B and 8x7B evaluator): Pearson 0.6-0.7 against GPT-4 on Likert benchmarks,
   72-85% agreement with humans on pairwise benchmarks. [https://arxiv.org/abs/2405.01535, 2024]
3. JudgeBench (ICLR 2025): on hard pairs with objective labels, GPT-4o scores 50.9%, about chance.
   Judge agreement collapses when the verdict needs capability the judge lacks.
   [https://arxiv.org/abs/2410.12784, 2024/2025]
4. "Catch Me If You Can? Not Yet" (EMNLP Findings 2025): imitation scored by an ensemble (authorship
   attribution, verification, style matching, AI detection), 400+ authors, 40k+ generations per model;
   LLMs match structured styles (news, email) and fail informal ones (blogs, forums).
   [https://arxiv.org/abs/2509.14543, 2025-09-18]
5. "Authorship gap": LUAR, an LLM judge and function-word stylometry correlate with each other at
   |r| < 0.07 on 50 blog authors; every personalisation method scored 0.484-0.508 on LUAR, below a
   cross-author human floor of 0.626. An uncalibrated metric hides the gap. No human raters.
   [https://arxiv.org/html/2604.26460, 2026-08-14]
6. Few-shot prompting gives up to 23.5x higher style-match accuracy than zero-shot; matched LLM text has
   lower perplexity than human text (15.2 vs 29.5). [https://arxiv.org/abs/2509.24930, 2025]
7. LUAR (EMNLP 2021): author embeddings from sets of texts; checkpoints LUAR-MUD and LUAR-CRUD (Reddit,
   Apache-2.0, card says `en`); a multi-vector variant on Qwen3-0.6B. Portuguese: not established.
   [https://huggingface.co/rrivera1849/LUAR-MUD]
8. mStyleDistance (ACL Findings 2025): content-agnostic style embedding on XLM-RoBERTa-base (~0.3B),
   MIT, loads via sentence-transformers, trained on synthetic data in 9 non-English languages; claims
   generalisation to unseen languages [author]. Portuguese coverage and ONNX export: not established;
   XLM-R exports to ONNX as a standard path. [https://arxiv.org/abs/2502.15168, 2025]
9. STEB, a 2026 style-embedding benchmark, exists; not read. [https://arxiv.org/pdf/2606.31741, 2026]

## What was measured, by whom, on what data

Items 1-3: general judge agreement on chat and QA pairs, not style. Items 4-5: authorship metrics on
real authors' texts, all English, none validated against human "sounds like the author" ratings. Nothing
on LinkedIn posts, 50-500-post corpora, or pt-BR.

## Reading

Item 5 is the design constraint: a raw fidelity number means nothing without the two floors, and the
brief's decision 21 (score shown, never a gate) is the only honest way to present it. The judge cost
lesson from item 3: a small judge is fine for easy criteria (platform fit rubric) and untrustworthy for
the hard one (voice), so the registry needs two judge rows, and R17's cross-vendor rule applies to both.
The style-embedding path is the one place a Python-only artifact may be needed (R14): mStyleDistance
converts to ONNX in principle and runs in Node via transformers.js, and that conversion is an offline
step. If pt-BR coverage fails, the fidelity part of the score ships as judge-only for Portuguese Voices
until an embedding is validated.

## Decision fed

- Precision score, fidelity part: style-embedding distance to the corpus centroid and to k nearest
  exemplars, with the two floors; labelled as a relative position, never a percentage.
- Judge: pairwise (draft vs a real exemplar, or A vs B) with order swap for voice; absolute rubric for
  platform fit; deterministic contract check first (length, line structure, hashtag count and
  placement, mention conventions).
- Model registry: two judge rows (cheap rubric judge; strong pairwise judge), different vendor from the
  drafting model (R17).
- Eval slice: one calibration run per language comparing the cheap and strong judges on forge's corpus.

## Open items

- mStyleDistance pt-BR coverage; LUAR transfer to Portuguese; ONNX conversion and accuracy.
- Any study correlating embedding distance with human "sounds like me": none found.
- Judge cost per judgement: R12 estimates it at about $0.05 on Opus-class per draft.
- STEB results, Wegmann et al. and STEL not fetched.

## Confidence

Medium on judge biases and fixes (primary). Low-to-medium on the embedding fidelity score (English,
non-LinkedIn, no human validation).
