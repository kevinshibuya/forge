# The hybrid background reaches the renderer as a placeholder token, never as prompt bytes

The hybrid lane's text step writes `__HYBRID_BG__` where the background image belongs, and the real data URI is substituted at Playwright render time only. Base64 image data is never put in a prompt. The earlier design did exactly that and produced run #12's failure — a ~1.9M-character prompt — which is why the check is now a live invariant: a healthy hybrid text prompt is around 16K characters.

Source: `HANDOFF-hybrid-orchestration.archived.md` (§What shipped, §Verified); `docs/manual-testing-guide.md` §J5 and §5 (run #12, "the retired base64-in-prompt hybrid bug").

## Consequences

- The rendered PNG and its `bg.png` persist as siblings in the candidate group directory, and the stored `htmlSource` holds the placeholder token, so a stored candidate stays re-renderable and small.
- The canvas editor inherits the same reversal contract: it must put the placeholder back before saving.
