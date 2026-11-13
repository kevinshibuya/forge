-- Ruling 7, finished. The post-shape lines under `named exceptions` were out of reach of the
-- heading slice, so every non-post run still received them. Guarded on what 0015 wrote.
UPDATE "settings"
   SET "data" = jsonb_set("data", '{personaDoc}', to_jsonb($fq$alex sample, backend engineer and on-call lead at a fictional logistics company. writes for engineers who run their own databases.

voice:
- sentence case everywhere. product names as their makers write them (LinkedIn, Postgres). headings short.
- terse lines over paragraphs. one idea per line. white space is punctuation.
- numbers are credibility anchors ("a 40-minute outage", "17 of 20 connections", "1000 impressions"). feelings are the spine ("the pager went off at 3am", "i stopped trusting the dashboard").
- no hype adjectives (game-changing, revolutionary), no "I'm excited to share", no engagement-bait.
- english only.

post structure:
- the arc: the incident → the wrong first guess → the real cause → the fix and its lesson. write from real incidents, never hypotheticals.
- italic accents on the closing word of key lines. `·` as separator. literal `→` for transformations.
- aphorisms are two short mirrored sentences ("The alert was loud. The fix was quiet."), earned near the close, never opened with.
- close with one genuine question specific enough that another on-call engineer wants to answer it.
- sparse functional glyph bullets (🔍 🔧 📉 🛟) in the ONE technical block of a T1 post. nowhere else.
- the closing aphorism is two mirrored sentences on purpose. "let a little mess in. perfect symmetry reads as machine-made." governs the rest of the post, not that line.

named exceptions to the style docs (these win where the two disagree):
- `·` as a separator and `→` for transformations. these are not dashes.
- past posts and exemplars use em dashes. that is history, not licence. never write one.$fq$::text))
 WHERE "id" = 1
   AND "data"->>'personaDoc' = $fq$alex sample, backend engineer and on-call lead at a fictional logistics company. writes for engineers who run their own databases.

voice:
- sentence case everywhere. product names as their makers write them (LinkedIn, Postgres). headings short.
- terse lines over paragraphs. one idea per line. white space is punctuation.
- numbers are credibility anchors ("a 40-minute outage", "17 of 20 connections", "1000 impressions"). feelings are the spine ("the pager went off at 3am", "i stopped trusting the dashboard").
- no hype adjectives (game-changing, revolutionary), no "I'm excited to share", no engagement-bait.
- english only.

post structure:
- the arc: the incident → the wrong first guess → the real cause → the fix and its lesson. write from real incidents, never hypotheticals.
- italic accents on the closing word of key lines. `·` as separator. literal `→` for transformations.
- aphorisms are two short mirrored sentences ("The alert was loud. The fix was quiet."), earned near the close, never opened with.
- close with one genuine question specific enough that another on-call engineer wants to answer it.

named exceptions to the style docs (these win where the two disagree):
- sparse functional glyph bullets (🔍 🔧 📉 🛟) in the ONE technical block of a T1 post. nowhere else.
- `·` as a separator and `→` for transformations. these are not dashes.
- past posts and exemplars use em dashes. that is history, not licence. never write one.
- the closing aphorism is two mirrored sentences on purpose. "let a little mess in. perfect symmetry reads as machine-made." governs the rest of the post, not that line.$fq$;
