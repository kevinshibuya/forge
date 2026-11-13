# No long-running Python service in v1, and judgement is cross-vendor

Kevin's opening request named Python and FastAPI as the home of a rebuilt RAG. The research (`docs/research/2026-09-24-r14-python-as-libraries.md`, `r04`, `r05`, `r08`, `r17`) found every candidate library with a TypeScript path, a hosted API, or an offline shape: DSPy has Ax in TS or runs offline to compile a prompt that TS ships; document parsing is a hosted OCR call; evals are evalite on vitest; and the one real pull, a style-embedding model for the Draft score's voice part, is a research artifact that converts to ONNX offline and runs in Node through transformers.js if it converts. So v1 runs no long-running Python service. Python is allowed as an offline compile step or a per-job function. The condition that reopens this is precise: a Python-only model that must answer inside a user request at a latency a per-job cold start cannot meet. The precision-score slice starts with a spike that can trigger it: transformers.js inference of mStyleDistance plus a multilingual NLI model on the target Fly machine, measuring latency and memory, with pt-BR coverage checked; if it fails, the Python ADR is written then, with a per-job function (Modal-style) costed, and Portuguese voice fidelity ships judge-only meanwhile.

## The judges

The Draft score's cheap parts (fit, Tells) and its rubric judge run on every draft; the strong pairwise voice judge runs once, at approve, so a draft's score reads "provisional" until then and a T1 stays under $0.50. The drafting vendor and the judging vendor are always different (which models is the registry's to say and will change; the rule is the vendor split), the judge prompt never names the model, and pairwise calls run twice with the order swapped, a win counted only when both agree. The reason is measured, not stylistic: LLM judges recognise and prefer their own output, and self/other labels in the prompt bias them either way. Judge results are cached by hash of (judge model, prompt version, input, output). The eval's first job is to measure its own variance, because 40 pairs give about ±15 percentage points and a gate that cannot go red is not a gate; retrieval changes are therefore an eval experiment, not a slice, until the harness has shown it can detect an effect of the expected size.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` premise claim 2 and decision 21; S4 round 1 Q7, Q16.

## Considered

A FastAPI sidecar for the RAG. Rejected: the retrieval forge needs is a selector over whole posts, not document QA, and no library in the Python ecosystem changes that; the sidecar's cost (a second deploy, test suite and contract for a solo developer racing to a beta) buys nothing named.

Jev (TypeSafe's classifier) for Triage, platform-fit scoring or Tell pre-filtering. Out of v1: no measurement covers those tasks, Portuguese is unsupported, and parity with a small LLM came only after decomposition plus a trained head. A gated Triage trial is recorded in `r06` for when triage latency is a felt problem.

A single-vendor judge. Rejected on the self-preference evidence above.

## Consequences

The voice part of the Draft score is shown as a position between two floors, never as a percentage, because an uncalibrated style metric hides the gap between generated and human text. The first floor is the Voice's own held-out posts against its corpus; the second, "other authors", comes from a fixed public or licensed set per language shipped with the eval slice, never from another Tenant's rows, which decision 24 forbids even without training.

Ax, transformers.js and the ONNX conversion are dependencies of the eval and precision slices, not of the api's request path, until the spike says otherwise.
