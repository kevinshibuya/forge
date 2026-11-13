# R1. Exemplar selection for generation

Research note for the forge v2 brief (research contract R1). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable). "Not established" means the pass did not
find it.

## Verdict

No primary source shows that document-QA retrieval machinery (structure-aware chunking, contextualized
embeddings, hybrid lexical arms with RRF, reranking) improves few-shot exemplar selection for
generation on a corpus of a few hundred short texts. What the literature supports, in order: retrieval
from the author's own history beats a non-personalised prompt; similarity plus some diversity beats
similarity alone on some tasks; a selector trained on downstream output quality beats every
off-the-shelf retriever. Chunking a post under 3,000 characters has no support either way, and every
cited setup retrieves whole items.

## Evidence

1. LaMP (7 personalisation tasks, among them news headlines, product reviews and tweet paraphrase)
   compared Random, Recency, BM25 and Contriever for choosing items from the user's profile. Retrieval
   from the profile beats a non-personalised prompt; no retriever wins everywhere (Contriever on most
   tasks, BM25 on two generation tasks in the user-based split).
   [https://aclanthology.org/2024.acl-long.399.pdf, ACL 2024]
2. Salemi et al. trained the retriever on the downstream generation metric (RL, or distillation from
   the LLM) and added a per-input retriever-selection model: statistically significant gains over
   baseline retrievers on 6 of 7 LaMP datasets. [https://arxiv.org/abs/2404.05970, 2024]
3. A LaMP follow-up used BM25 because Contriever added 10 to 30 s per sample "while not significantly
   outperforming BM25 on many LaMP tasks" [secondary, not verified in the PDF].
   [https://arxiv.org/pdf/2310.20081, 2023]
4. LongLaMP extends the benchmark to long-form personalised generation, with retrieval over the user's
   profile. [https://arxiv.org/pdf/2407.11016, 2024]
5. "Catch Me If You Can? Not Yet" (EMNLP Findings 2025): style imitation from a few samples reaches
   authorship-verification fidelity above 95% on formal domains (news, email) and as low as 17 to 21%
   on informal ones (blogs). The bottleneck it finds is the model's ability to imitate, not which
   exemplars are retrieved. [https://arxiv.org/abs/2509.14543, 2025-09]
6. ICL selection survey: KATE (embedding kNN), EPR (BM25 candidates, then a retriever trained on LM
   scoring). Diversity-only drifts from the input; similarity-only is redundant.
   [https://arxiv.org/abs/2301.00234, revised 2024]
7. Demonstration order and choice can swing performance by more than 30% on classification, sometimes
   below random. [https://arxiv.org/pdf/2402.15637, 2024]
8. Diversity-aware reranking of a similar neighbourhood helps over pure similarity on some tasks.
   [https://www.arxiv.org/pdf/2505.01842v1, 2025-05]
9. Cited by the scout from memory, unverified: Lu et al. 2022 (order sensitivity), Su et al. 2022
   (vote-k), Levy et al. 2023 (diverse demonstrations), Ye et al. 2023 (DPP-based selection).

## What was measured, by whom, on what data

LaMP and LongLaMP (UMass): per-user profiles of hundreds of items, ROUGE, accuracy, MAE; profiles are
not ranked by engagement. Salemi 2024: same benchmark, retrievers optimised on the downstream metric.
The style-imitation paper: authorship classifiers on outputs across news, email, forum and blog authors.
KATE, EPR, vote-k, DPP: classification and semantic parsing, not style-conditioned writing. Not measured
anywhere found: hybrid plus RRF, cross-encoder reranking, or contextual chunk embeddings for exemplar
selection in personal-style generation; engagement-weighted selection.

## Reading

This settles the first premise claim in the brief ("change how our RAG works") in the direction the
brief's stance predicted: the retrieval shape forge needs is a *selector* over whole posts, and the
document-QA machinery from the reference RAG project answers a question forge does not ask. Two things carry over from
the reference RAG project regardless: the discipline of a golden set that gates any retrieval change (R17 says what
the metric is), and the model registry with a cost ledger.

Evidence 5 is the sharpest finding in the whole set: for informal text, imitation fidelity is the
ceiling, not selection. That moves effort from retrieval toward what the draft prompt carries (the
Constitution, the persona, the edit-derived rules of R4) and toward judging (R5). It also warns against
promising voice fidelity numerically.

## Decision fed

- Retrieval v2: one embedding per Post (no chunking); dense top-k over the Voice's corpus; MMR-style
  diversity over the neighbourhood; the published body as the retrievable text (R4); outcome and
  `verdict` Signals as weights once they exist. A BM25 arm has LaMP support on some generation tasks
  and costs one `tsvector` column; RRF fusion has none in this setting. No reranker (R2 agrees).
- Ordering: measured on classification, not on style; treat as an eval variable, not a design choice.
- The precision score's fidelity part carries a calibrated floor, not a percentage (R5).

## Open items

- No study on a LinkedIn or social-post corpus; none on engagement as a selection signal.
- No head-to-head of hybrid plus RRF or reranking against dense retrieval for exemplar selection.
- Whether exemplar choice moves style fidelity at all, given the informal-domain ceiling.
- Item 3 and item 9 citations unverified.

## Confidence

Medium. LaMP is primary and on-topic; the "no benefit" conclusion for QA machinery rests on absence of
evidence, not a negative result. High that chunking is irrelevant at this item size.
