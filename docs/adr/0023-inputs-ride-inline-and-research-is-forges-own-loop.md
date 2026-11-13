# Inputs ride inline under a cap, and Research is a managed Run that plans, fetches and drafts

Two things reached the model only through the CLI: an Input, which the CLI opened with `Read` from a
staged directory, and the web, which the CLI searched and fetched with its own tools inside the fences
of ADR 0015. The `api` backend has neither, and the S3 review found the brief had assumed both away.
Decision, in three parts.

**Inputs.** Parsed to text at attach (`unpdf` or `pdf.js` for born-digital PDFs, `mammoth` for DOCX, a
hosted OCR call when little text comes back, images passed to the model as vision references), stored on
the Input, and carried inline in the draft's prompt up to a cap of 8 files and 120,000 characters per
run; an Input that would break the cap is refused at attach with the numbers. The Inputs block sits
under its own cache breakpoint, after the Constitution's, because a refine re-sends it. Passage
retrieval over long documents (chunking, quote-verified citations, the reference RAG project's shape) is the recorded
successor for the user who hits the cap, not a v1 build.

**Research.** A managed Run with two steps, both audited. Step 1, kind `research_plan`: a cheap model
returns `{queries[]}` under the Output contract, each query capped at 200 characters. forge then
searches through a `Search` interface (Perplexity Search, fast tier) and fetches **only the URLs the
search returned**, itself, through the SSRF guard `inputs/url-article.ts` already has (pinned DNS,
private ranges refused, every redirect hop re-checked), extracting readable text locally; no third-party
reader sits in the path, because a reader that fetches on its own network makes forge's guard moot.
Caps per run: 5 searches, 10 fetches, 200,000 characters of fetched text, settings a Tenant cannot
raise. Step 2 is the draft, with the fetched text in the Run's context row under the second cache
breakpoint. The S4 grill had picked Jina Reader as the fetcher; the review's point that forge's guard
then guards nothing is right, and Kevin ratified the change on 2026-09-24.

**Citations.** The Output contract gains a structured `claims` list, `{text, sourceRef, quote}` per
factual claim, and the body stays clean prose. After the run, each quote is checked as a normalised
substring of the fetched text; a claim without a verbatim quote is labelled paraphrased. The Draft
score's grounding part is the share of claims verified.

Source: `docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md` decision 21 and the S3
amendments; `docs/research/2026-09-24-r07-research-without-home.md`, `r08-document-parsing.md`; S4
round 1 Q1, round 2 Q21 and Q25; the S4 review (both legs).

## Considered

A forge-side read tool loop (`read_input`, `fetch`) so the model pulls what it wants. Rejected: it is
the CLI's behaviour rebuilt by hand, it multiplies audited calls per draft, and it gives the model the
one outward channel (a URL it writes) that the two-step design removes. The cache argument the first
draft of this ADR made against it was wrong (appended turns keep the prefix); the security argument is
the one that stands.

Chunked retrieval over Inputs from day one. Rejected as the first build: the right shape for a
100-page report and the wrong one for the 2,000-word article and 10-page deck a post usually needs.

Anthropic's built-in web search tool. Rejected: it returns encrypted results and 150-character
`cited_text`, which gives forge no clean text to verify a quote against. Its web fetch tool's output
shape is unchecked and remains an open item as a possible `Fetcher` alternative.

Inline citation markers in the body, as the reference RAG project does it. Rejected: a post body ships verbatim to a
platform, and a marker in it is a stripping bug waiting to happen.

## Consequences

ADR 0015's fences protected a home directory that no longer exists on the hosted backend; what remains
of the threat model is SSRF, covered by the guard, and exfiltration through a model-written URL, covered
by fetching only search-returned URLs and by the model having no fetch tool at all.

The `path` Input kind dies (ADR 0017, amended). `file` and `url` stay.

A draft carrying 120,000 characters of Inputs and 200,000 of fetched text is about 80k input tokens per
call; R12 is re-run on that shape before a price is set, and the second cache breakpoint is what keeps
its refines from paying it twice.

Prompt injection through a fetched page is not eliminated: a page can still instruct the model. The
model's outward channels are the search queries of step 1, capped and logged as Tool calls on the Run,
and nothing in step 2.
