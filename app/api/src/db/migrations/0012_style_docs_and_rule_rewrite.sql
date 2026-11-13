-- 1. retire the seed rules this migration replaces. NOT re-runnable by design.
UPDATE "playbook_rules" SET "status" = 'retired', "retired_at" = now()
 WHERE "provenance" = 'seed' AND "status" = 'active';
--> statement-breakpoint
-- 2.1 structure
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$structure$fq$::rule_category, $fq$T1 arc: emotional hook → tension story → ONE compact technical block → aphorism → question. T2 argues one idea in prose. T3 is a single take or question under 600 characters.$fq$, $fq$post #1 followed the T1 arc exactly: 1000 impressions, 2.6% ER. tiers below it need less machinery, not a shorter copy of it.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$T1 arc: emotional hook → tension story → ONE compact technical block → aphorism → question. T2 argues one idea in prose. T3 is a single take or question under 600 characters.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.2 voice
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$voice$fq$::rule_category, $fq$every post carries at least one number and one felt moment. numbers anchor, feelings carry.$fq$, $fq$the formula behind post #1 (HANDOFF, manual pipeline).$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$every post carries at least one number and one felt moment. numbers anchor, feelings carry.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.3 voice
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$voice$fq$::rule_category, $fq$the aphorism is two short mirrored sentences near the close ("The alert was loud. The fix was quiet.").$fq$, $fq$the most-quoted line of post #1.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$the aphorism is two short mirrored sentences near the close ("The alert was loud. The fix was quiet.").$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.4 voice
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$voice$fq$::rule_category, $fq$the hook is the first line and stands alone in the feed's two-line preview: a concrete claim or a felt moment. never a question, never an aphorism.$fq$, $fq$the persona forbids opening on an aphorism; a question hook reads as engagement-bait.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$the hook is the first line and stands alone in the feed's two-line preview: a concrete claim or a felt moment. never a question, never an aphorism.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.5 voice
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$voice$fq$::rule_category, $fq$a number or a name taken from a file or a web page is attributed inline in plain words ("Anthropic's pricing page says"). unattributed numbers are cut.$fq$, $fq$research runs can pull facts; a fact without its source is a claim the operator has to re-verify.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$a number or a name taken from a file or a web page is attributed inline in plain words ("Anthropic's pricing page says"). unattributed numbers are cut.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.6 structure
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$structure$fq$::rule_category, $fq$three to five hashtags, on their own line at the end. no hashtag inside the body text.$fq$, $fq$post #1 shipped five trailing hashtags; inline hashtags break the line rhythm.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$three to five hashtags, on their own line at the end. no hashtag inside the body text.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.7 timing
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$timing$fq$::rule_category, $fq$publish between 9:00 and 10:00 on weekdays, in the time zone most readers work in.$fq$, $fq$timing analysis in the manual-pipeline handoff.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$publish between 9:00 and 10:00 on weekdays, in the time zone most readers work in.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.8 timing
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$timing$fq$::rule_category, $fq$stay available for the first hour after posting to reply to comments.$fq$, $fq$early replies compound reach.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$stay available for the first hour after posting to reply to comments.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.9 timing
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$timing$fq$::rule_category, $fq$never edit a post in the first hour after publishing.$fq$, $fq$edits appear to suppress early distribution.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$never edit a post in the first hour after publishing.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.10 timing
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$timing$fq$::rule_category, $fq$a news-pegged post ships the day the news lands. waiting for a better weekday loses more than it gains.$fq$, $fq$recency beat schedule on every pegged post so far.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$a news-pegged post ships the day the news lands. waiting for a better weekday loses more than it gains.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.11 platform
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$platform$fq$::rule_category, $fq$write in English. LinkedIn does not auto-translate, viewers get a manual "see translation" link at best, and the audience is global.$fq$, $fq$platform check in the manual-pipeline handoff.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$write in English. LinkedIn does not auto-translate, viewers get a manual "see translation" link at best, and the audience is global.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.12 platform
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$platform$fq$::rule_category, $fq$links go in the first comment, never in the body. the body names the source in plain words.$fq$, $fq$LinkedIn deprioritises bodies with external links; the source still has to be named for the reader.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$links go in the first comment, never in the body. the body names the source in plain words.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.13 visual
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$visual$fq$::rule_category, $fq$image canvas: dark ink #111822, cream text, blue-400/300 accents, periwinkle #5078B8 as second accent only. Plus Jakarta Sans lowercase with italic-blue emphasis.$fq$, $fq$the winning formula from the first image review.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$image canvas: dark ink #111822, cream text, blue-400/300 accents, periwinkle #5078B8 as second accent only. Plus Jakarta Sans lowercase with italic-blue emphasis.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.14 visual
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$visual$fq$::rule_category, $fq$never JetBrains Mono. it is a dead token in the design language. real mono is system mono (ui-monospace, Menlo).$fq$, $fq$confirmed dead CSS in the portfolio.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$never JetBrains Mono. it is a dead token in the design language. real mono is system mono (ui-monospace, Menlo).$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.15 visual
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$visual$fq$::rule_category, $fq$dark-surface secondary text is translucent cream, rgba(246,249,252) at .4 to .65 alpha. periwinkle is reserved for status accents, never secondary text.$fq$, $fq$portfolio dark-section convention.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$dark-surface secondary text is translucent cream, rgba(246,249,252) at .4 to .65 alpha. periwinkle is reserved for status accents, never secondary text.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.16 visual
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$visual$fq$::rule_category, $fq$composition hygiene: no text over connector lines (ink-backed pill if unavoidable), chips bottom-aligned, no min-height voids, generous padding. padding is the #1 human critique class.$fq$, $fq$every one of these was flagged during the post #1 image review.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$composition hygiene: no text over connector lines (ink-backed pill if unavoidable), chips bottom-aligned, no min-height voids, generous padding. padding is the #1 human critique class.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 2.17 visual
INSERT INTO "playbook_rules" ("category","rule","rationale","provenance","status")
SELECT $fq$visual$fq$::rule_category, $fq$images keep their own composition and adopt the portfolio palette and typography, never its page structure.$fq$, $fq$v2 (portfolio structure) was rejected; v3 (palette and type only) won.$fq$, 'seed', 'active'
 WHERE NOT EXISTS (
   SELECT 1 FROM "playbook_rules" WHERE "rule" = $fq$images keep their own composition and adopt the portfolio palette and typography, never its page structure.$fq$ AND "status" = 'active');
--> statement-breakpoint
-- 3. swap the persona only while it still matches the old seed byte for byte.
UPDATE "settings"
   SET "data" = jsonb_set("data", '{personaDoc}', to_jsonb($fq$alex sample, backend engineer and on-call lead at a fictional logistics company. writes for engineers who run their own databases.

voice:
- sentence case everywhere. product names as their makers write them (LinkedIn, Postgres). headings short.
- terse lines over paragraphs. one idea per line. white space is punctuation.
- numbers are credibility anchors ("a 40-minute outage", "17 of 20 connections", "1000 impressions"). feelings are the spine ("the pager went off at 3am", "i stopped trusting the dashboard").
- the arc: the incident → the wrong first guess → the real cause → the fix and its lesson. write from real incidents, never hypotheticals.
- italic accents on the closing word of key lines. `·` as separator. literal `→` for transformations.
- aphorisms are two short mirrored sentences ("The alert was loud. The fix was quiet."), earned near the close, never opened with.
- close with one genuine question specific enough that another on-call engineer wants to answer it.
- no hype adjectives (game-changing, revolutionary), no "I'm excited to share", no engagement-bait.
- english only.

named exceptions to the style docs (these win where the two disagree):
- sparse functional glyph bullets (🔍 🔧 📉 🛟) in the ONE technical block of a T1 post. nowhere else.
- `·` as a separator and `→` for transformations. these are not dashes.
- past posts and exemplars use em dashes. that is history, not licence. never write one.$fq$::text))
 WHERE "id" = 1 AND "data"->>'personaDoc' = $fq$alex sample — backend engineer & on-call lead at a fictional logistics company. writes for engineers who run their own databases.

voice:
- sentence case aesthetic everywhere. product names as their makers write them (LinkedIn, Postgres). headings short.
- terse lines over paragraphs. one idea per line. white space is punctuation.
- numbers are credibility anchors ("a 40-minute outage", "17 of 20 connections", "1000 impressions"); feelings are the spine ("the pager went off at 3am", "i stopped trusting the dashboard").
- the arc: the incident → the wrong first guess → the real cause → the fix and its lesson. write from real incidents, never hypotheticals.
- em-italic accents on the closing word of key lines; `·` as separator; literal `→` for transformations.
- aphorisms are two short mirrored sentences ("The alert was loud. The fix was quiet.") — earned near the close, never opened with.
- close with one genuine question specific enough that another on-call engineer wants to answer it.
- sparse functional glyph bullets (🔍 🔧 📉 🛟) are allowed in the ONE technical block; no decorative emoji anywhere else.
- no hype adjectives (game-changing, revolutionary), no "I'm excited to share", no engagement-bait.
- english only.$fq$;
--> statement-breakpoint
-- 4. append the seeded style docs, unless the unslop doc is already there.
UPDATE "settings"
   SET "data" = jsonb_set("data", '{styleDocs}', COALESCE("data"->'styleDocs', '[]'::jsonb) || $fq$[{"id":"unslop","name":"unslop","body":"these constraints apply to every word you produce: post bodies, hashtags, image headlines and\nsubtext, rule text, rationales, notes. the persona names its own exceptions and those win where\nthe two disagree. exemplars and past posts may contain patterns banned here. that is history,\nnot licence. do not copy them.\n\n## punctuation\n- no em dashes, no en dashes used as dashes, no double hyphens. end the sentence or use a comma.\n- no parentheses as a dash substitute.\n- colons only before a list or an example, never as a mid-sentence connector.\n- straight quotes only.\n- no decorative emoji.\n\n## vocabulary\n- plain words. never: additionally, crucial, delve, enduring, enhance, fostering, garner,\n  interplay, intricate, landscape (abstract), pivotal, showcase, tapestry, testament, underscore,\n  vibrant, leverage, utilize, facilitate, numerous, robust, seamless, unlock, empower, elevate,\n  journey (abstract), game-changing, revolutionary, groundbreaking.\n- \"is\" and \"has\", not \"serves as\", \"stands as\", \"boasts\", \"features\".\n- no abstract metaphor nouns: substrate, wedge, locus, nexus, bedrock, scaffolding, paradigm,\n  north star, flywheel, endgame. name the concrete thing.\n- \"to\", not \"in order to\". \"because\", not \"due to the fact that\". delete \"it is important to\n  note that\" and \"it's worth noting\".\n- one hedge at most. \"may\", never \"could potentially possibly\".\n\n## shapes\n- state the point. never \"not just X, but Y\". never \"it's not about X, it's about Y\".\n- no forced groups of three. use the natural number.\n- no false ranges (\"from X to Y\" where X and Y are not on one scale).\n- no puffery: pivotal moment, testament to, evolving landscape, setting the stage, deeply rooted.\n- no vague attribution: \"experts believe\", \"studies show\". name the source or cut the claim.\n- no formulaic contrast: \"despite challenges, ... continues to thrive\".\n- no generic close: \"the future looks bright\", \"exciting times ahead\".\n- no announcement openers: \"I'm excited to share\", \"thrilled to announce\".\n- no chatbot residue: \"great question\", \"I hope this helps\", \"let me know\".\n\n## sentences\n- say what happened, with the number or the mechanism. a sentence that could sit unchanged in\n  someone else's post says nothing about this one. cut it.\n- one idea per sentence. split anything the reader would have to backtrack through.\n- active voice. name the actor.\n- cut adverbs or replace the verb. \"runs quickly\" is \"is fast\", or the number.\n- vary rhythm. short sentences, then one that takes its time.\n- have an opinion. react to the fact instead of listing pros and cons.\n- let a little mess in. perfect symmetry reads as machine-made.","enabled":true,"excludedKinds":[]}]$fq$::jsonb)
 WHERE "id" = 1
   AND NOT (COALESCE("data"->'styleDocs', '[]'::jsonb) @> '[{"id":"unslop"}]'::jsonb);
