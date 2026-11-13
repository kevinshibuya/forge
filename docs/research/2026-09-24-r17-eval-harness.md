# R17. Eval harness for content

Research note for the forge v2 brief (research contract R17). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable).

## Verdict

A vitest-native eval: a small author-labelled golden set per Voice, a judge from a different vendor than
the generator with model labels stripped from the prompt, order-swapped pairwise calls, a file-hashed
judge cache, and a pairwise "old versus new" win-rate as the gate. evalite (built on vitest) is the only
framework worth adopting; promptfoo is the fallback for its compare view; the hosted platforms bring
lock-in for nothing forge needs at this scale. For exemplar retrieval, hit@k has no ground truth and is
replaced by the downstream judge win-rate.

## Evidence

1. Self-preference bias is measured: LLM evaluators recognise their own outputs and rate them higher
   than human or other-model text that humans judge equal; self-recognition correlates linearly with the
   bias. [NeurIPS 2024, https://proceedings.neurips.cc/paper_files/paper/2024/file/7f1f0218e45f5414c79c0679633e47bc-Paper-Conference.pdf]
2. Judges score lower-perplexity (more familiar) text higher whoever wrote it.
   [https://arxiv.org/abs/2410.21819, 2024-10]
3. 2026 follow-ups: self-preference is a directional deviation that can go either way; self/other
   *labels* in the prompt induce bias too, so generator identity must not appear in the judge prompt.
   [https://arxiv.org/html/2604.22891v2; https://arxiv.org/pdf/2608.18091, 2026-08]
4. evalite: built on vitest, `.eval.ts` files, local UI, CI via static HTML and score thresholds,
   model-agnostic, open source [vendor]; caching and licence not stated on the page.
   [https://www.evalite.dev/, 2026-09-24]
5. promptfoo caches provider responses on disk (`~/.promptfoo/cache`, 14-day TTL, keyed on provider,
   request digest, config, vars; errors not cached) [vendor]. Community tier free and open source;
   acquired by OpenAI March 2026, still MIT and multi-provider (R14); product leaning toward red-teaming.
   [https://www.promptfoo.dev/docs/configuration/caching/; /pricing]
6. Braintrust Starter $0 (10k scores/month, 14-day retention), Pro $249/month; datasets and experiments
   live in its hosted store [vendor]. [https://www.braintrust.dev/pricing]

## Reading

Two rules follow from items 1-3 and cost nothing: the judge vendor differs from the drafting vendor
(Sonnet drafts, a GPT-class or Gemini-class model judges, or the reverse), and the judge prompt never
names the model. The golden set is small by necessity (a Voice has 50-500 posts) and the scout's
binomial arithmetic is the honest constraint: 40 pairs give about ±15 percentage points at 95%, so a
pairwise gate needs a wide margin or more pairs, and the eval's first job is to measure its own variance
by running the same set three times. Banned patterns stay deterministic in code and never touch the
judge.

For exemplar retrieval this replaces the reference RAG project's hit@k with something forge can measure: drafts made
with retrieval v2 exemplars against drafts with v1 exemplars (and against random exemplars as the
floor), judged pairwise, plus the author's own preference on a sample.

## Decision fed

- Eval slice (precedes retrieval v2 in the plan order): evalite on vitest; per-Voice golden set of 20-40
  held-out posts plus author pairwise preferences ("which would you post") plus a "which is mine" test;
  rubric parts as binary checks; deterministic Tells; judge cache keyed on hash(judge model, prompt
  version, input, output); cheap judge on every change, strong judge plus author sample at release;
  re-judge only changed outputs.
- Judge independence rule for the model registry (R5): cross-vendor, unlabelled, order-swapped.
- Retrieval metric: downstream pairwise win-rate; hit@k only as a sanity check on synthetic cases.

## Open items

- Stable-signal size for style evals: no primary source; measure variance empirically.
- Not fetched: Langfuse, Braintrust SDK, OpenAI Evals API, AI SDK eval docs, evalite licence and caching.
- Whether the cheap judge agrees with the strong one on voice fidelity for this corpus: one calibration
  run per language.

## Confidence

High on self-preference bias and on the promptfoo and Braintrust facts. Medium on framework trade-offs.
Low on item counts (estimate, not finding).
