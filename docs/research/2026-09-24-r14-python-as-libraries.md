# R14. Python, framed as libraries

Research note for the forge v2 brief (`docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md`,
research contract R14). Evidence gathered by a scout on 2026-09-24; verdict and reading by the main
session (fable). Facts marked [vendor] come from the vendor's own page; [secondary] from a blog or an
agency page. "Not established" means the pass did not find it, not that it is false.

## Verdict

Under a speed-to-beta objective the brief's stance holds: no candidate Python library needs a
long-running Python service before the beta. Each has a TypeScript equivalent, a hosted API, or an
offline-only path. If Python enters, it enters as an offline compile step or a per-job function, never
as a FastAPI sidecar in the request path.

## Evidence

1. **DSPy.** Ax (`@ax-llm/ax`) presents itself as the DSPy framework for TypeScript, with signatures,
   agents, flows and optimizers; release 24.0.21 shipped 2026-09-22, and 24.0.20 claimed "typesafe
   parity" [vendor]. Whether its optimizers match DSPy's MIPROv2 and GEPA is not established.
   [https://github.com/ax-llm/ax/releases, 2026-09-22]
2. **Parsing, hosted.** Mistral OCR 4: $4 per 1,000 pages, $2 through the Batch API; Document AI $5 per
   1,000 pages [vendor]. At forge's volume (a few documents per post) this is cents per tenant per month.
   [https://mistral.ai/news/ocr-4/, 2026] [https://mistral.ai/pricing/api/]
3. **Parsing, open source.** Docling (IBM, Python) is described as strong on clean PDFs and tables with
   Markdown export; no TypeScript port exists [secondary].
   [https://www.aimadetools.com/blog/mistral-ocr-4-complete-guide/, 2026]
4. **Embeddings and small models in Node.** Transformers.js v3 (October 2024) runs 1,200+ ONNX models
   in Node, Bun and Deno with WebGPU; feature-extraction covers MiniLM, bge-small, nomic-embed [vendor].
   Converting a model that lacks an ONNX export is an offline `optimum` step in Python, not a runtime
   dependency. Whether LUAR or another style-embedding model has an ONNX export on the Hub is not
   established. [https://huggingface.co/blog/transformersjs-v3, 2024-10]
   [https://www.promptfoo.dev/docs/providers/transformers/]
5. **Evals.** Promptfoo was acquired by OpenAI in March 2026, stays MIT-licensed and multi-provider, and
   the repo was active on 2026-09-24 [vendor]. evalite's and Braintrust's current state: not established.
   [https://github.com/promptfoo/promptfoo/releases, 2026-09-24]
6. **Per-job Python.** Modal's cold start is queue wait plus first-invocation work; `min_containers` and
   `buffer_containers` buy warm capacity at a cost [vendor]. A course page claims 10 to 30 s for a first
   call and idle recycling after 15 to 30 minutes [secondary]. Fly, Railway and Render cold starts were
   not measured. [https://modal.com/docs/guide/cold-start]
7. **The sidecar tax.** Only agency and vendor pieces were found, no primary postmortem from a named team
   running a TS main service with a Python ML sidecar. They agree on two points: FastAPI is overhead
   unless a Python ML library does real work, and a JS team pays a second deploy, a second dependency
   tree and a contract to keep in sync. [https://blaxel.ai/blog/typescript-vs-python-ai-agents, vendor]
8. **Contract tooling** (openapi-typescript, zod-to-openapi, pydantic-to-zod): maturity not established
   this pass.

## Reading

The four candidates sort cleanly:

- **DSPy**: two non-sidecar paths. Ax in TypeScript, or DSPy run offline to compile a prompt and its
  demonstrations, with the artifact shipped as data the TS engine loads. The second path also fits the
  brief's decision 20, since a compiled prompt is a proposal a human reads before it ships.
- **Document parsing**: a hosted OCR API makes the question moot at forge's volume. R8 decides which.
- **Style embeddings (LUAR and the like)**: the one real Python pull, because the models are research
  artifacts without maintained JS ports. It is a per-job or offline computation (embed a corpus once,
  embed a draft once), so a Modal-style function or an ONNX conversion covers it. R5 decides whether
  forge needs a style embedding at all.
- **Evals**: Promptfoo in TS; ragas or deepeval as an offline CLI only if a metric is missing. R17 decides.

The sidecar trigger, stated once so the ADR can cite it: a FastAPI service enters only when a
Python-only model must answer inside a user request at a latency a per-job cold start cannot meet.
Nothing in the brief's v1 has that shape.

## Decision fed

The Python ADR (S4): "Python is an offline and per-job tool, not a runtime; no FastAPI sidecar in v1",
with the trigger above as the reopening condition.

## Open items

- Ax's optimizer parity with DSPy (MIPROv2, GEPA) and its maintainer base; dspy.ts was not checked.
- ONNX availability and post-conversion accuracy for LUAR or an equivalent style model.
- LlamaParse and Unstructured API pricing (R8 covers).
- evalite and Braintrust state (R17 covers).
- A primary postmortem on the TS-plus-Python-sidecar pattern.
- Measured cold starts on Fly, Railway, Render for a per-job Python function.

## Confidence

Medium on the verdict: three of four candidates have a clear non-sidecar path and the fourth is
offline-shaped. Low on the maturity details, which rest on vendor pages and are marked not established.
