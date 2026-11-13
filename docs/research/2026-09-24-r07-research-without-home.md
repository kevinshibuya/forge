# R7. Research without a home directory

Research note for the forge v2 brief (research contract R7). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable). Prices are list prices from vendor pages
fetched that day; nothing was benchmarked.

## Verdict

A Research run of about 3 searches plus 5 fetched pages costs $0.02-0.05 in API fees before model
tokens on Brave, Exa, Tavily or Perplexity Search, inside the brief's $0.10 target. Anthropic's built-in
web search tool is priced the same but returns encrypted result blobs and 150-character `cited_text`,
which gives forge no clean text to verify a quote against, so it does not fit the grounding design.
The fetcher is a hosted reader (Jina, Tavily Extract) or Cloudflare Browser Rendering; a dedicated
sandbox is not the state of practice, SSRF hygiene is.

## Evidence

1. Anthropic web search tool: $10 per 1,000 searches plus token costs; results arrive as
   `encrypted_content`; citations always on with up to 150 chars of `cited_text`; `allowed_domains`,
   `blocked_domains`, `max_uses`. Terms: outputs shown to end users must include citations; modified or
   combined outputs "display citations as appropriate based on consultation with your legal team".
   [https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool, 2026-09-24]
2. Brave Search API: $5 per 1k requests, $5 free credit monthly, 50 QPS; Answers plan $4 per 1k plus $5
   per 1M tokens at 2 QPS. FAQ: storing results "in part or whole" needs a plan that grants storage
   rights; zero data retention is Enterprise only. [https://brave.com/search/api/, 2026-09-24]
3. Exa: Search $7 per 1k (10 results), Contents $1 per 1k pages, Answer $5 per 1k, Deep Search $12-15
   per 1k, $10 free monthly [vendor]. [https://exa.ai/pricing, 2026-09-24]
4. Tavily: $0.008 per credit; basic search 1 credit, advanced 2; Extract 1 credit per 5 URLs basic;
   1,000 free credits monthly. About $8 per 1k basic searches, $1.60 per 1k basic extracts.
   [https://docs.tavily.com/documentation/api-credits, 2026-09-24]
5. Perplexity: Search API $5 per 1k standard or $1 per 1k fast, no token charge; Sonar $1/$1 per 1M
   plus $5-14 per 1k requests; Sonar Pro $3/$15. [https://docs.perplexity.ai/getting-started/pricing]
6. Serper: 2,500 free queries; paid tiers not established. [https://serper.dev/]
7. Jina Reader: billed per token (price not established); 500 RPM free and paid, 5,000 premium; JS
   rendering default; PDF extraction; robots.txt check is an optional header; does not bypass anti-bot
   [vendor]. [https://jina.ai/reader/]
8. Firecrawl: 1 credit per basic page; Standard 100k credits $83/month (~$0.83 per 1k pages); Hobby 5k
   credits $16/month annual; zero retention Enterprise only. [https://www.firecrawl.dev/pricing]
9. Cloudflare Browser Rendering: paid plan 10 browser-hours/month included, then $0.09/hour; 10
   concurrent browsers, $2 per extra; free 10 min/day, 3 browsers.
   [https://developers.cloudflare.com/browser-rendering/pricing/]

## Reading

Three things decide this, none of them price. First, the grounding check in the brief's decision 21
needs the fetched text, so the search API must return URLs forge fetches itself; the Anthropic tool's
encrypted results rule it out for this job even though it would be the least code. Second, Brave's
storage clause may treat a cited snippet saved on a Post as "storing results in part"; forge stores the
*fetched page's* quote, not Brave's result, which is a different artefact, but the S4 spec should say so
and a read of the full terms is owed before Brave is chosen over Perplexity Search. Third, the fence
that ADR 0015 built around the CLI's `Read` was protecting the operator's home directory; a hosted
fetcher running off forge's infrastructure has no home directory to protect, and the remaining risk is
SSRF (private IPs, DNS rebinding, redirects, size), which is a server-side function with an allowlist,
not a sandbox.

Citation verification: with clean text, an exact or normalised substring match on the quoted span is
deterministic and free, and the reference RAG project's quote-marker pattern transfers if the marker is stripped at
render time. A paraphrased claim without a verbatim quote cannot be substring-checked; the honest UI
marks it "paraphrased from" and a judge or NLI check scores it, with accuracy on short prose not
established.

## Decision fed

- Research rebuild: a search API returning URLs (Perplexity Search fast at $1 per 1k, or Brave at $5
  per 1k pending its terms) plus a hosted reader (Tavily Extract or Jina) with a self-hosted Playwright
  fallback; SSRF hygiene in the fetcher; caps per run kept from ADR 0015 (searches, fetches, bytes).
- Sources: `kind: web` gains the fetched text hash and the verified quote span; a paraphrased Source is
  labelled as such.
- Grounding score: fraction of factual claims with a verified quote, shown, never a gate.

## Open items

- Full terms of Exa, Tavily, Jina, Firecrawl, Serper, OpenAI web search (page 403) on caching and
  content generation; Anthropic web fetch tool pricing.
- Brave's storage clause against forge's stored quote.
- PDF support and robots.txt defaults for Tavily Extract, Firecrawl, Cloudflare.
- Accuracy of NLI or judge checks on paraphrased claims in short prose.

## Confidence

High on prices (primary pages). Medium-low on terms (two read). Low on quality and citation-method
accuracy (no evidence gathered).
