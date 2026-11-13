# R4. Learning from edits and outcomes for generation

Research note for the forge v2 brief (research contract R4). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable).

## Verdict

Two methods fit the brief's constraint (learning acts on exemplar selection and on approved rule
proposals, never on the Constitution) without fine-tuning: CIPHER-style inference of a natural-language
preference from each (draft, edit) pair, surfaced as a rule proposal; and retrieval of the published body
as the positive exemplar, weighted by later Signals. Both are a few prompts plus k-NN over embeddings
and run in TypeScript. Prompt optimisers (GEPA, MIPROv2) rewrite instructions, which the constraint
forbids unless their candidates enter the proposal queue. Nothing here justifies Python.

## Evidence

1. PRELUDE/CIPHER (Gao et al.): an LLM infers a natural-language description of the user's latent
   preference from each (draft, edit) pair; at generation time CIPHER retrieves the preferences inferred
   for the k closest past contexts, aggregates them, and adds the result to the prompt. No fine-tuning:
   the authors call it costly, non-scaling per user, and possibly degrading.
   [https://arxiv.org/abs/2404.15269, v3 2024-11-23]
2. CIPHER on summarisation and email writing with simulated users: lowest edit-distance cost among
   baselines, including retrieval of past edits without preference inference, "with only a small
   overhead in LLM query cost"; learned preferences "significantly similar" to ground truth. Exact
   numbers not pulled. [same]
3. LaMP: retrieval-augmented personalisation from the user's own history helps zero-shot and fine-tuned
   LMs alike. [https://aclanthology.org/2024.acl-long.399/, 2024]
4. Salemi et al., retriever trained on LLM output quality (ROPG-RL, ROPG-KD), LLM frozen: +5.5% average
   over prior SOTA on LaMP; +9.8% ROUGE-1 on email subjects, +2.7% headlines, +1.2% tweet paraphrase.
   [https://arxiv.org/html/2404.05970, 2024]
5. GEPA (ICLR 2026 oral): reflective instruction rewriting with a Pareto frontier; +13% aggregate vs
   +5.6% for MIPROv2, prompts about 33% shorter, beats GRPO by 6% with up to 35x fewer rollouts. Tasks
   are QA, reasoning and privacy, not stylistic writing. [https://arxiv.org/abs/2507.19457, 2025-07]
6. MIPROv2 tunes instructions and demonstrations together by Bayesian optimisation; BootstrapFewShot
   tunes demonstrations only. [https://axllm.dev/gepa/, 2026-09-24]
7. Ax (`@ax-llm/ax`): "the pretty much official DSPy framework for TypeScript" [vendor]; 2.9k stars,
   Apache-2.0; ships GEPA, AxBootstrapFewShot, ACE, and mentions MiPRO; no Python needed [vendor].
   [https://github.com/ax-llm/ax, 2026-09-24]
8. TextGrad: Python-only; no personalised-writing result verified.
9. Pairwise preferences from hook picks: DPO needs weight updates, ruled out; using pairs as in-prompt
   contrast or as a bandit signal has no measured result found.
10. Bandit or outcome-weighted exemplar selection for social posts: no primary paper with results; the
    closest is ROPG (item 4), offline and on a quality reward, not engagement.

## What was measured, by whom, on what data

Gao et al. (Cornell / MSR): edit-distance cost with simulated LLM users on summarisation and email; no
human users. Salemi et al. (UMass): ROUGE, accuracy, MAE on LaMP public profiles; not LinkedIn, not
engagement. GEPA: benchmark accuracy with verifiable answers; no style benchmark. Nothing measures
engagement as the target; for a single author it is noisy and low-n.

## Reading

CIPHER is the mechanism behind the marketing claim "it learns from every edit you make", and it lands
inside the brief's rule without contortion: the inferred preference *is* a proposed Playbook rule, with
provenance `edit:<revision pair>`, approved or rejected like a Retro proposal. That also gives Retro a
second input stream without changing its contract. The published body as positive exemplar is the
cheapest adaptation of all and needs only the anchoring Revision R3 found missing.

GEPA and MIPROv2 are the strongest optimisers on paper and the wrong shape for forge: their output is a
rewritten instruction, and the brief forbids silent rewriting. Routing their candidates into the
proposal queue is admissible and worth a later experiment, not a v1 slice. Engagement stays a weak prior
on exemplar weight; nothing in the literature supports more.

## Decision fed

- Adaptation design: `edit` → CIPHER-style preference inference → Playbook proposal (lane b);
  draft-to-published pairs → published body as exemplar (lane a); `hook_pick` and `verdict` → exemplar
  weights and in-prompt contrast pairs (lane a); `outcome` → weak prior on weight (lane a).
- Prompt optimisers: admissible only through the proposal queue; not in v1.
- R14: no Python. CIPHER is prompts plus k-NN; Ax covers GEPA and bootstrap in TS if ever needed.

## Open items

- CIPHER's exact numbers and 2025-2026 successors with real users.
- MiPRO status in Ax; dspy.ts maturity.
- Whether edit distance is a valid signal on LinkedIn posts, where an author may rewrite for reasons
  other than style (topic, facts, mood).
- Engagement attribution for a single author (timing and topic confounds): no method found.

## Confidence

High that CIPHER and retrieval-based methods work without fine-tuning and in TS. Medium on gain size
for forge (simulated users and public benchmarks only). Low on anything built on engagement.
