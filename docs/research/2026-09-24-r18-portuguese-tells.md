# R18. Portuguese Tells

<!-- design-tells: acknowledged -->
<!-- The filler phrases quoted below are the objects of study, not prose. -->

Research note for the forge v2 brief (research contract R18). Evidence gathered by a scout on
2026-09-24, with one read of `app/shared/src/tells.ts`; verdict and reading by the main session (fable).

## Verdict

No published Portuguese "AI vocabulary" list exists that is large enough to ship. The literature gives a
method that transfers (excess-word and log-odds analysis against a human baseline) and a handful of
attested Portuguese markers. forge's Portuguese Tells ship as a seed list marked attested or hypothesis,
then get measured on each Voice's own corpus. Two code facts fall out: the current regexes use ASCII
`\b`, which breaks on accented words, and two English Tells (curly quotes, the dash) do not transfer
because Portuguese typography uses them legitimately.

## Current list (code)

`tells.ts` defines: em-dash, dash-substitute, curly-quote, ai-vocab (`AI_VOCAB`), fancy-is,
not-just-but, filler ("it is important to note", "it's worth noting", "in order to"…), hedge-stack,
metaphor-noun, plain-word, announcement. All patterns are English. `wholeWords` uses `\b`, which in
JavaScript without the `u` flag and Unicode-aware boundaries is ASCII-only: "é", "ênfase" or "tapeçaria"
match at the wrong boundaries.

## Evidence

1. Kobak et al.: "excess vocabulary" in 15M+ PubMed abstracts against a counterfactual extrapolated
   from earlier years; at least 13.5% of 2024 abstracts LLM-processed; method language-agnostic but needs
   a large timestamped corpus; code at github.com/berenslab/llm-excess-vocab.
   [https://www.science.org/doi/10.1126/sciadv.adt3813, 2025-07]
2. Liang et al.: corpus-level LLM-modified fraction (up to 17.5% of CS abstracts by Feb 2024); no
   per-document verdict, so it does not fit a linter. [https://arxiv.org/abs/2404.01268, 2024]
3. Rodrigues, Sturm and Pinheiro: ~200 human Portuguese news texts against parallel GPT-4o, Mistral
   Large and Llama 3.3 70B outputs. AI-leaning n-grams: "mas também", "além disso", "em relação",
   "importância", "é fundamental", "é essencial"; human-leaning: concrete dates, "por isso", "vai",
   personal references; AI text "more formal, structured, positive, and motivational". BR or EU variant
   not established. [https://pmc.ncbi.nlm.nih.gov/articles/PMC12969083/, iScience, 2026-02-12]
4. PT-Detect (UFOP, ENIAC 2025): three classes (human pre-LLM journalism, AI-generated, AI-rewritten);
   98.18% binary accuracy; no lexical list; dataset availability not established.
5. MULTITuDE: 74,081 news texts in 11 languages including pt. [https://arxiv.org/abs/2310.13606, 2023]
6. MultiSocial: social-media texts in 22 languages including pt (Telegram, Twitter, WhatsApp…), CC BY
   4.0 research-only on Zenodo; the closest genre to LinkedIn. [https://arxiv.org/html/2406.12549, 2025-07]
7. Detecting-ai/pt-ai-detector: BERT Portuguese classifier, CC-BY-NC-4.0, models only.
8. Monroe, Colaresi and Quinn, "Fightin' Words" (2008): log-odds ratio with an informative Dirichlet
   prior, z-scored; handles low counts better than a raw ratio; no minimum corpus size published.
   [https://languagelog.ldc.upenn.edu/myl/Monroe.pdf]

## Transfer

- Supported by item 3: filler and connectors ("além disso", "é fundamental", "é essencial", and by
  extension "vale ressaltar", "é importante destacar") map to `filler`; "não só/apenas X, mas também Y"
  is the Portuguese `not-just-but`.
- Hypotheses, unsourced, to be measured: the travessão as a Tell (caution: legitimate for dialogue and
  parentheticals, so the English base rate does not transfer); "não é X, é Y"; triads; "mergulhar",
  "tapeçaria", "nesse sentido", "impulsionar", "potencializar", "alavancar", "no cenário atual";
  gerundismo ("vou estar enviando").
- Does not transfer: `curly-quote` (Portuguese uses “ ” and « » legitimately).

## Method

Fightin' Words z-scores over unigrams and bigrams, the Voice's real posts against model drafts of the
same ideas; flag |z| > 1.96 with a minimum count of 5-10 on the AI side; a frequency ratio with add-k
smoothing as the cheap alternative. Corpus size is not established; heuristic 30-50 paired posts
(10-20k tokens a side) before bigram z-scores settle. The draft-versus-published pairs forge already
stores (R3) are exactly this corpus, so the per-Voice list grows from the `edit` Signal for free.

## Decision fed

- Per-language Tells (decision 14): a `pt-BR` list seeded from item 3 plus flagged hypotheses; `em-dash`
  and `curly-quote` off or lowered for Portuguese; Unicode-aware word boundaries (`u` flag,
  `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`) as a fix that also corrects the English lint on accented names.
- A per-Voice learned list from the edit corpus, proposed to the user like a Playbook rule.

## Open items

- PT-Detect data; any corpus-derived Portuguese list (none found); BR versus EU differences; gerundismo
  frequency in LLM output; corpus-size threshold.

## Confidence

Medium on method and datasets. Low on Portuguese lexical items beyond item 3.
