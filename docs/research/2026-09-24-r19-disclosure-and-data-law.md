# R19. Disclosure and data law

Research note for the forge v2 brief (research contract R19). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable). Orientation for a product decision, not
legal advice; a lawyer reads the open items before launch.

## Correction after the S3 review (2026-09-24)

The fable review leg read the AI Act's roles the other way from the verdict below, and its reading is
the likelier one. Under the Act, whoever places an AI system on the market under its own name is its
provider; the user of that system is the deployer. forge is placed on the market under its own name
and integrates upstream models, the textbook downstream-provider case. So: Article 50(2)'s
machine-readable marking duty is **forge's**, and it covers "audio, image, video or text content"
insofar as technically feasible; Article 50(4)'s disclosure duty and its human-review exemption belong
to the **Tenant**, who publishes under their own name. The Omnibus grace period helps only systems on
the market before 2 August 2026, which v2 is not. Evidence item 4 below already marked forge's status
"not established"; the verdict should not have said "deployer" flat.

What changes in the decision fed: machine-readable marking of generated images (keep the generator's
C2PA manifest through the composite step) and, where feasible, of generated text is forge's duty; the
optional label and the logged approval step stay, now as the Tenant's human-review record. The
lawyer's first question is provider status. The original text follows unchanged.

## Verdict

Under the EU AI Act's Article 50, forge is most likely a deployer, not a provider, because it resells
upstream models; its duties are to pass through the upstream provider's machine-readable image marks
(keep C2PA, never strip it) and to offer a labelling option. The text-labelling duty very likely falls
away because the user edits, approves and publishes under their own name, and the approve step is the
record of that. The heavier work is data law: a sub-processor list with transfer mechanisms, ANPD
standard clauses for Brazilian users' data sent abroad, a deletion SLA inside 30 days, and no
cross-tenant training, all of which the brief's decision 24 already promises.

## Evidence

1. Art. 50(2): providers of systems generating synthetic audio, image, video or text must mark outputs
   machine-readably. Art. 50(4): deployers publishing AI-generated text "with the purpose of informing
   the public on matters of public interest" must disclose it, except where the content "has undergone a
   process of human review or editorial control and where a natural or legal person holds editorial
   responsibility". Deepfake images carry their own label duty. [https://artificialintelligenceact.eu/article/50/]
2. The Commission maintains Art. 50 guidelines and published the final Code of Practice on marking and
   labelling (voluntary, with EU label icons).
   [https://digital-strategy.ec.europa.eu/en/policies/guidelines-transparency-ai-generated-content, 2026]
3. Art. 50 applies from 2 August 2026; the Digital Omnibus on AI (Regulation (EU) 2026/1744) reportedly
   gives systems on the market before that date a grace period to 2 December 2026 for 50(2) marking
   [secondary; Official Journal text not checked].
4. Whether a wrapper that brands the output is a "provider" under 50(2) is not established; commentary
   treats deployer labelling of text as limited to public-interest content and the human-review exemption
   as text-only [secondary: Kennedys, Stibbe, 2026].
5. LinkedIn reads C2PA manifests and shows a "CR" / "AI info" tag on images that carry them; an image
   without a manifest gets no tag [secondary: Fortune 2024-11-26; Lumethic 2026]. No LinkedIn API rule
   requiring AI disclosure found.
6. X reportedly drops C2PA metadata on upload and applies its own labels under its synthetic media
   policy [secondary]; policy text not verified.
7. Brazil: Resolução CD/ANPD nº 19/2024 governs international transfers; since 23 August 2025
   contract-based transfers must use the ANPD standard clauses verbatim or ANPD-approved clauses.
   [https://www.gov.br/anpd/pt-br/assuntos/noticias/resolucao-normatiza-transferencia-internacional-de-dados, 2024-08]
8. LGPD basis likely contract performance (Art. 7, V); an encarregado is required (Art. 41) with
   relaxation for small agents under ANPD Resolução 2/2022 [not verified against primary text].
9. PL 2338/2023 passed the Senate 2024-12-10; with a Chamber special committee; plenary vote scheduled
   2026-05-27, outcome not established; not law as of this note.
   [https://www25.senado.leg.br/web/atividade/materias/-/materia/157233]
10. EU-US Data Privacy Framework stands (General Court, Latombe T-553/23, 2025-09-03; appeal C-703/25 P
    pending) [secondary]. For US model APIs, rely on the vendor's DPF certification with SCCs in its DPA
    as fallback.
11. GDPR mechanics (general knowledge, not re-fetched): Art. 6(1)(b) contract as basis for the imported
    history; Art. 17 erasure without undue delay, within one month (Art. 12(3)); Art. 28 sub-processor
    authorisation via a published list plus change notice.
12. California SB 942 as amended by AB 853, operative 2 August 2026, covers "covered providers" of
    generative image, video or audio systems with over 1,000,000 monthly users; forge is far below
    [secondary: Morgan Lewis 2026-08].
13. FTC: Endorsement Guides and the Consumer Reviews rule (16 CFR 465, October 2024) bar fake
    testimonials including AI-generated ones; no general federal duty to label AI posts found.

## Reading

The approve-before-publish step, which forge already has, is the artefact that carries the Art. 50(4)
exemption: log it as the human-review record (who, when, which Revision). For images, the pipeline must
preserve whatever mark the generator embeds; the HTML composite step in the hybrid lane is where a C2PA
manifest would be lost, so the renderer either re-signs or the Post carries the generator's manifest
alongside. An optional "made with AI" toggle with the Code's icon costs nothing and pre-empts the
provider-versus-deployer question. Reddit's training clause, which prompted this question, has a
counterpart in every jurisdiction here: decision 24's "no cross-tenant training" is the promise that
keeps forge out of every consent regime at once.

## Decision fed

- Data promise (decision 24): deletion within 30 days, including token revocation at LinkedIn and X and
  deletion requests to sub-processors; no cross-tenant training, in writing.
- Disclosure UI: keep upstream marks intact; optional AI label per Post with the EU icon; log the
  approval as the human-review record.
- Sub-processor list: model APIs, image API, search and fetch APIs, hosting, database, storage, email;
  each with region and mechanism (EU: DPF or SCCs; Brazil: ANPD standard clauses); a change notice.
- Deploy slice: hosting region in São Paulo (R15) reduces but does not remove the transfer question,
  because the model APIs are abroad.

## Open items

- Provider versus deployer status for a wrapper under 50(2): read the final Code and guidelines.
- Omnibus text (2026/1744) on the grace period; PL 2338 vote outcome; ANPD DPO waiver from Res. 2/2022.
- LinkedIn and X developer terms on AI content (R10, R11 found none).
- Whether a generated image of the user's own likeness is a "deepfake" needing a label regardless of
  review.

## Confidence

Medium on the EU and California frameworks. Low-to-medium on platform rules and PL 2338 status. GDPR
and LGPD mechanics well established but not re-fetched.
