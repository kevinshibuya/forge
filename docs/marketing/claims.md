# Marketing claims

A running list of what the product may say about itself, each traced to the decision that makes it true.
Started 2026-09-24 from the v2 product brief (`docs/superpowers/specs/2026-09-24-forge-v2-product-brief.md`);
amended the same day after the S2 research and the S3 review. A claim is **settled** when the decision
behind it is approved and nothing external can void it; **pending** when it waits on evidence, a
measurement or a third party. Copy for a page is written from this list, never from memory.

Kevin asked for this file so the adaptation story (Q5) survives into the marketing page.

| # | Claim | Behind it | Status |
|---|-------|-----------|--------|
| 1 | It writes in your voice, learned from your own posts. | Decisions 19, 22: history import at onboarding; Voice profile drafts the persona from it. | pending: on X the import is one click (R11); on LinkedIn it is an upload of the member's export, 24-72 hours to arrive (R10). "From the first day" is true for X only. |
| 2 | It learns from every edit you make and every instruction you give it. | Decision 19 (`edit` and `instruction` Signals), 20 (style edits become proposals). | pending: the proposal path is validated offline on tenant 1's edits before it exists for anyone else (R4). |
| 3 | Nothing about how it writes changes without your approval. Every rule change is a proposal you accept or reject. | Decision 20: no silent rewriting of the Constitution; Retro proposes. Founding line, kept. | settled |
| 4 | It publishes to X at the time you set, and to LinkedIn where LinkedIn lets it. | Decisions 15, 16: Armed posts, Publish. | pending: LinkedIn publishing depends on the self-serve product or CM approval (memo question 3); X is settled. |
| 5 | Your analytics come through the official APIs where the platform grants access, otherwise from your own export. Never a browser extension. | Fact sheet 2026-09-24; §8.2 bans extensions; R10. | pending: LinkedIn API analytics is beta-scale until a discretionary Standard tier; the export path is the launch path. |
| 6 | Every draft carries a score you can read: voice, grounding, platform fit, tells. It never blocks you. | Decision 21. | pending: voice fidelity has no validated metric (R5, low-medium) and Portuguese may ship judge-only; grounding quality unmeasured (R7). The "never blocks" half is settled. |
| 7 | Facts in a post trace to sources you can open. | Decision 21 (grounding), Research rebuild (R7). | pending: R7 and S4-Q1. |
| 8 | Branded images, drafted for the post and edited in the app. | Decision 23; the canvas editor exists. | settled |
| 9 | One action adapts a post to the other platform, in that platform's shape. | Decisions 11, 12: Adapt, Form. | settled |
| 10 | English and Portuguese. | Decision 14. | pending: Portuguese Tells are hypotheses until measured (R18, low). |
| 11 | Your data trains nothing shared. Learning is yours alone. | Decision 24. | pending: needs a confirmed no-training term from every sub-processor; Google's unpaid tier trains on inputs, so the image default runs on a paid tier (R19, memo finding 23). |
| 12 | Delete your account and everything we hold goes: we revoke X access, link you to LinkedIn's settings to revoke ours, and every sub-processor purges within 30 days. | Decision 24; the pattern of ADR 0018; R19. | pending: sub-processor purge terms per vendor; backup retention windows (R15: Supabase keeps daily backups 7 days). |
| 13 | You keep the final word on every word. Manual publishing stays possible on any post. | Founding line; decision 16. | settled |
| 14 | Made-with-AI marking is preserved on images and offered on posts. | Decision 24 (Art. 50 reading, R19). | pending: lawyer's read of forge's provider status. |

## Not claims

Things the product will not say, because a decision or a fact forbids them:

- "Predicts how your post will perform." Dropped from the score entirely (decision 21, S3).
- "Posts to Reddit." Decision 4; Reddit's API terms.
- "Grows your followers." No decision supports an outcome claim; the product measures outcomes, it does
  not promise them.
- "Everything gone instantly." Deletion has per-source timelines (decision 24).
- Anything about a price, until the ledger has a month of data (R12) and a launch decision exists.
