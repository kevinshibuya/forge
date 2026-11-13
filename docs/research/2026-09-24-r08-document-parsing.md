# R8. Document parsing for Inputs

Research note for the forge v2 brief (research contract R8). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable).

## Verdict

At forge's volume a hosted API handles scanned PDFs and tables for under $5 a month at 500 pages, so
parsing does not justify a Python runtime. The pipeline is: TS-native text extraction first (unpdf or
pdf.js for born-digital PDFs, mammoth for DOCX), a hosted OCR call when little text comes back or
tables matter, and the drafting model's vision input for images. Every hosted option is an HTTP call
from Node.

## Evidence

1. OmniDocBench (CVPR 2025): 1,651 PDF pages, 10 document types, 5 layout types, 5 language types;
   block- and span-level annotations; reproducible; leaderboard includes Docling, Marker, MinerU,
   Mistral OCR. The authoring lab also builds MinerU, a conflict of interest.
   [https://github.com/opendatalab/OmniDocBench, 2026]
2. OmniDocBench v1.5: Mistral OCR overall 78.83, text edit 0.164, table TEDS 70.03 (version tested not
   established); Marker 1.8.2 overall 71.3; MinerU2.5 overall 90.67, table TEDS 88.22 (self-reported).
   Docling's exact score not retrieved. [OmniDocBench repo; https://arxiv.org/pdf/2509.22186]
3. Docling: MIT, local layout and table models (TableFormer), Python; reachable from Node over HTTP via
   docling-serve (MIT). [https://arxiv.org/html/2501.17887v1, 2025-01]
4. Mistral OCR 4 (2026-06-23): $4 per 1,000 pages, $2 batch; Document AI $5 per 1,000; OCR 3 $2 per
   1,000 ($1 batch) [vendor; OCR 4 figures via a secondary page, confirm on mistral.ai/pricing].
5. LlamaParse: 10k free credits monthly, then $1.25 per 1,000; Fast 1 credit per page (~$0.00125),
   Agentic 10 (~$0.0125), Agentic Plus 45 (~$0.056) [vendor].
   [https://developers.llamaindex.ai/llamaparse/general/pricing/]
6. Unstructured API: sources conflict, $0.015 per page after 10k free or $0.03 flat after 15k free
   [vendor]. Reducto r-1 Parse $0.01 per page preview, $150 free usage [vendor].
7. Node-native (pdf.js, unpdf, pdf-parse, mammoth): text only, no layout model, no table structure, no
   OCR; scanned PDFs return empty text. Python-only: Docling, Marker, MinerU, Unstructured OSS.
8. Monthly cost at 500 pages: Mistral OCR 4 about $2 ($1 batch); LlamaParse $0 in every mode but
   Agentic Plus; Unstructured $0 inside free pages; Reducto $5, covered by free credit at first.

## Reading

forge's Inputs are a few documents per post, mostly born-digital (an article, a report, a deck exported
to PDF). The TS extractors cover those for free; the hosted OCR is the fallback for scans and tables,
detected by a low text-per-page ratio. Docling would be the choice if forge ran a Python service anyway;
it does not (R14), and docling-serve as a separate container is more infrastructure than a $2 monthly
API call. The one thing the current code does that no parser fixes is the URL fetch: R7 covers it.

## Decision fed

- Inputs pipeline: unpdf or pdf.js → text-density check → Mistral OCR (or LlamaParse Fast, whichever
  wins a 20-document spot check on forge's real Inputs) → Markdown stored on the Input; mammoth for
  DOCX; images passed to the drafting model as vision input; the content-addressed cache idea from
  the reference RAG project (sha256 of bytes plus parser version) so a re-attached file costs nothing.
- R14: parsing does not justify Python.

## Open items

- Docling's OmniDocBench v1.5 score; whether OCR 3 or 4 is the entry; Marker's licence text; latency
  for every tool; Unstructured's actual price; Chunkr; each API's data-retention terms.
- URL-to-Markdown quality: no benchmark found; Readability plus Turndown-style TS tools not compared.

## Confidence

Medium on prices (vendor pages, some secondary). Medium-low on quality rankings (one benchmark with a
stake in it). High that the hosted route costs under $20 a month at 500 pages.
