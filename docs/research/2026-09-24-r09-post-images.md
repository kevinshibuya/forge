# R9. Post images

Research note for the forge v2 brief (research contract R9). Evidence gathered by a scout on
2026-09-24; verdict and reading by the main session (fable). Prices are vendor list prices fetched that
day.

## Verdict

forge's hybrid lane (generated background under a rendered text layer) is what the market sells, under
the names "brand kit" and "templates". The rebuild is a change of generator and renderer, not of
design. The cost decision is the generator: gpt-image-2 at high quality costs about $1 per image on its
token pricing, Nano Banana 2 costs $0.067 at 1K, and a four-Candidate batch on the first is the
difference between a $4 and a $0.30 post (R12). Text rendering inside the image matters less for the
hybrid lane, since the HTML layer carries the copy. Series consistency has no independent evidence
behind any method.

## Evidence

1. gpt-image-2: model id `gpt-image-2`, snapshot `gpt-image-2-2026-04-21`; generations and edits
   endpoints; inpainting; rate limits in images per minute (Tier 1: 5, Tier 5: 250).
   [https://developers.openai.com/api/docs/models/gpt-image-2, 2026-09-24]
2. gpt-image-2 pricing is per token: image output $30 per 1M, image input $8, cached $2, text input $5;
   batch half. R12 measured about 33.5k output tokens per generated image, so about $1.00 at high
   quality; medium about $0.25 (assumed). [https://developers.openai.com/api/docs/pricing]
3. Newer models `gpt-image-2.5-sunburst` (editing) and `gpt-image-2.5-flare` (speed and quality);
   quality low to max; sizes 1024x1024, 1536x1024, 1024x1536 plus custom within constraints; mask
   inpainting, multi-turn edits via Responses, streaming partials, transparent backgrounds.
   [https://developers.openai.com/api/docs/guides/image-generation, 2026-09-24]
4. Google: Gemini 3.1 Flash Image (Nano Banana 2) $0.045 at 0.5K, $0.067 at 1K, $0.101 at 2K; Nano
   Banana 2 Lite $0.0336 at 1K; Gemini 3 Pro Image $0.134 at 1K/2K; batch 50% off; Gemini 2.5 Flash
   Image shuts down 2026-10-02. Imagen 4 prices not returned.
   [https://ai.google.dev/gemini-api/docs/pricing, 2026-09-24]
5. Black Forest Labs: FLUX.1 (1.1 pro, Kontext) $0.04-0.08 per image; FLUX.2 per megapixel from $0.014
   (Klein 4B) to $0.07 (Max), FLUX.2 Pro about $0.03 [vendor]. [https://docs.bfl.ai/quick_start/pricing]
6. Recraft: V3 raster $0.04, vector $0.08; V4 raster $0.007-0.25; style creation from reference images
   $0.005; V3 inpainting $0.04. [https://www.recraft.ai/docs/api-reference/pricing]
7. Ideogram API per-image price not established (subscription plans only shown).
8. Text rendering, third-party blog, 20 prompts, method undocumented: Seedream 4.5 4.93/5, GPT Image 1.5
   4.88, FLUX.2 Pro 4.83, Ideogram 3.0 4.52; gpt-image-2 and Nano Banana Pro absent.
   [https://vibedex.ai/blog/best-ai-text-rendering-2026]
9. Blind-vote arena: gpt-image-2 #1 overall (506), general preference not text accuracy.
   [https://llm-stats.com/leaderboards/best-ai-for-image-generation, 2026-09]
10. Rendering: Cloudflare Browser Rendering 10 browser-hours/month included on paid, then $0.09/hour;
    Browserless $25/month for 20k 30-second units; htmlcsstoimage 1,000 images $14/month.
11. Competitors: Taplio carousels are templates filled by AI [vendor]; Supergrow generates carousels
    from posts, YouTube, blogs, PDFs at $12-39/month [vendor]; Predis.ai applies a brand kit (colours,
    tone, logos) and outputs per-platform aspect ratios with safe zones, $24-212/month [vendor]. No
    competitor publishes pipeline detail.

## Reading

Two decisions and one non-decision. First, the generator becomes a registry row like any model, so the
lane can run Nano Banana 2 by default and gpt-image-2 or 2.5 on request; the brief's per-Tenant budget
(decision 5) has to meter images separately because they dominate cost. Second, the Candidate count
default drops from four to two with "more like this" on demand, which halves the image bill without
touching the variator's job. The non-decision: the renderer. Playwright already runs in forge; on a
hosted API it is a container with Chromium, or Cloudflare's browser at effectively zero cost at beta
volume. Nothing in the evidence favours one; the deploy slice picks.

Target sizes (1200x627, 1080x1080, 1080x1350, 16:9) are not native outputs for any model; generate near
the aspect and let the HTML layer crop and compose, which the hybrid lane does today. Background refine
maps to the edits and mask endpoints on gpt-image-2/2.5 and to Kontext on FLUX.

## Decision fed

- Image lane rebuild: generator as a registry row (default Nano Banana 2 at 1K; premium gpt-image-2.5);
  default batch of two Candidates; images metered separately in the budget; renderer chosen in the
  deploy slice (self-hosted Playwright container or Cloudflare Browser Rendering).
- Brand consistency: Recraft's style-from-references at $0.005 is the cheapest thing to trial for a
  Voice-level style; no evidence ranks it against palette lock plus template, which forge already does.

## Open items

- gpt-image-2 per-image price by quality and size, and latency; gpt-image-2.5 pricing; Imagen 4; Ideogram
  API price and style-reference availability; FLUX 1.1 Pro and Kontext rates; Stability.
- Cold-start latency for Cloudflare, Browserless, Satori/Vercel OG (Satori needs no browser; unchecked).
- Typefully, Buffer, Canva, ContentStudio, AuthoredUp, Postiz, Lately pipelines.
- Any study of series consistency across methods: none found.

## Confidence

High on list prices. Low on text-rendering rankings and competitor pipelines. None on series
consistency.
