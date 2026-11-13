# kevinshibuya.com design language — extracted 2026-07-02

Synthesized from the portfolio repo (4 scouts + opus synthesis). Anchors are file:line in that repo.

# Portfolio Visual Design Language — Synthesized MAP

Everything below is anchored to `file:line` from the scout findings. Unless noted, all paths are relative to the portfolio repo root. The entire design system lives in a single ~2100-line stylesheet, `src/index.css`, with copy in `src/i18n/locales/en.json`.

---

## 0. Architecture note (how the tokens flow)

- Tokens are declared **twice, identically** — once in a Tailwind v4 `@theme` block and once as `:root` CSS vars — same hex values (`src/index.css:34-77`). There is **no `tailwind.config.js/ts`** (deadEnd, confirmed by 3 scouts). For an infographic you can treat `src/index.css:34-77` as the single source of truth.
- Fonts are **fully self-hosted** — NO Google Fonts CDN link anywhere (`index.html:281-291`, deadEnd confirmed by 2 scouts). Only `Plus Jakarta Sans` is actually loaded.

---

## 1. Color token usage

### Palette (all values `src/index.css:34-77`)

| Token | Hex | Primary role |
|---|---|---|
| cream | `#F6F9FC` | **Default page background** (`html,body` `:87-88`); nav-avail pill, work-list, chip bg |
| sand | `#EAF2F8` | **Secondary/alt section bg** (`.section--sand` `:589-594`); pill bg; chip/work-row hover |
| mist | `#D4E5F2` | **The universal 1px hairline border** — nav, pill, chip, work-list, hero-stats top, stats rows, archive, dividers (`:646,664,683,526,1436`) |
| ink | `#111822` | **Default text color** AND **dark section background** (`:87-88`, `:1082-1083`) |
| bark | `#2A4060` | **Secondary/body copy** — hero-desc, section-desc, bullets (`:514,625`) |
| dust | `#4A6A88` | **Tertiary/meta text** — smallest labels, numerals (`:538,701,1445`) |
| blue-50 | `#F4F8FE` | Callout/badge fills (work-highlight, work-mode-pill) `:747,796` |
| blue-100 | `#DCF0FF` | Pill hover bg `:653` |
| blue-200 | `#A2D2FF` | Light accent — ghost strokes, section-index on dark `:1088` |
| blue-300 | `#6DB8FF` | Decorative strokes, `::selection` bg, contact-title em `:97,1101` |
| blue-400 | `#3A96E8` | **Accent workhorse** — links, hovers, left-bars, icons, mono route-path `:604+` |
| blue-500 | `#1C6EC4` | **Deepest accent** — section-index label, section-title `<em>` `:604,623` |
| periwinkle-100/200 | `#C8D8F0` / `#8AAADA` | (declared; sparse use) |
| periwinkle-300 | `#5078B8` | **Distinct status accent** — company names, availability dot, mode dot `:230,761,741` |

**Key relationships:**
- **Blue ramp is the accent system**: 400/500 = interactive/link accent; 200/300 = decorative/ghost strokes; 50/100 = tinted fills.
- **Periwinkle-300 is a deliberate SECOND accent**, reserved for status (pulsing availability dot, work-mode dot) and company names — do NOT substitute blue here (`:230-236,761,741-743`).

### Dark "ink" section inversion (critical for an infographic)
`.section--contact` and `.footer` set `background:var(--ink); color:var(--cream)` (`:1082-1083,1178-1179`). On these surfaces:
- section-index swaps blue-500 → **blue-200** (`:1088`)
- secondary text uses **translucent cream**, not tokens: lede `rgba(246,249,252,0.6)`, row border `…0.12`, num `…0.4`, footer border `…0.08` (`:1104-1181`)
- **defensive override**: `.section--contact strong, .footer strong { color: var(--cream) }` exists because the global `strong{color:var(--ink)}` would be invisible on dark bg (`:115-121`) — a real gotcha to replicate.
- `.bento-card.is-dark`: desc-top → blue-200, title → cream, cs-link → cream @ 0.85 (`:916,930,939`). Note the dark card's *background* is set inline per-project, not in CSS (flagged `:877-930`).

---

## 2. Typography

### Families
- **Plus Jakarta Sans** — the only loaded face. Variable woff2, weight range **200–800**, roman + italic axes, `font-display:swap` (`src/index.css:6-29`). `--font-sans` = `'Plus Jakarta Sans', system-ui, -apple-system, sans-serif` (`:53,75`), applied to `html,body` (`:86`).
- **JetBrains Mono — CONTRADICTION / DEAD TOKEN.** Declared as `--font-mono` (`:76`) but has **no `@font-face` and `var(--font-mono)` is never referenced** (all 4 scouts independently confirm; deadEnds). Actual mono usage hardcodes system stacks:
  - `.project-cursor__pill` → `ui-monospace, SFMono-Regular, Menlo, monospace` (`:1054`)
  - `.project-detail-route-path` → `ui-monospace, monospace`, 12px, blue-400 (`:2038`)
  - inline code → `ui-monospace, monospace`, 0.92em (`:2090`)
  - **→ Flag for the designer: "mono" in this system renders as generic system monospace, NOT JetBrains Mono. Only use JetBrains Mono if you deliberately add it.**

### Heading scale
| Element | size | weight | line-height | letter-spacing | case | color |
|---|---|---|---|---|---|---|
| hero-name (h1) | `clamp(64px,11vw,192px)` | 700 | 0.92 | −0.05em | lowercase | ink; ghost line = mist fill + 1px blue-300 stroke (`:277-290`) |
| section-title | `clamp(44px,6vw,84px)` | 400 | 0.98 | −0.035em | lowercase | ink; `<em>` italic 400 blue-500 (`:611-624`) |
| contact-title (dark) | `clamp(80px,14vw,220px)` | 600 | 0.88 | −0.05em | lowercase | cream; `<em>` italic 500 blue-300 (`:1089-1102`) |
| project-detail-title | `clamp(40px,7vw,104px)` | 700 | 0.95 | −0.02em | lowercase | ink (`:1778-1786`) |
| loader-mark | `clamp(140px,30vw,320px)` | 700 | — | — | lowercase | cream on ink (`:349-368`) |
| footer marquee | `clamp(80px,18vw,280px)` | — | — | — | — | stroked outline glyphs (§6) (`:1203-1233`) |

### Body / small text
- hero-desc / section-desc / project paragraphs: **17px, line-height 1.7** (hero 1.75), color bark, lowercase, max-width 560px (`:512-519,625-632`).
- Stats "receipt" values: 56px/700, tabular-nums, −0.02em (`:1456-1464`). Hero stat numbers: 40px/700 (`:529-542`). **Note minor contradiction between scouts: hero-stat-value cited as both 40px (`:531`) and 56px — the 56px figure is the Stats-section `.stats-row-value` (`:1456`), 40px is `.hero-stat-v`. Two different elements.**

### Weights actually used
700 (hero/loader/stats-value/detail-title), 600 (buttons, all eyebrows, skills-title), 500 (nav-link, work-role-title, contact-label, pitch), 400 (section-title, body), 300 (hero-role-prefix, work-toggle) (`:162,279,547-550,712-713,838`).

---

## 3. Card & container motifs

### Border-radius vocabulary
- **14px** — bento-card, figure-img, mockup-frame (`:884`)
- **18px** — work-list, archive-list, project-detail-cover (the "bordered list panel" `:681-685,1619-1623`)
- **999px** — all pills/chips/buttons/nav-avail/search (`:547-670`)
- **8px** — nav-mark tile, dropdown option (`:157`)
- **6px** — project-cursor pill, inline code (`:1054,2090`)
- **`0 10px 10px 0`** — work-highlight callout (asymmetric, flush-left for the accent bar `:796-801`) — a signature deviation from the symmetric radii.

### Borders
- Default hairline: **`1px solid var(--mist)`** everywhere (`:646,664,683,526,1436`).
- `.btn--ghost`: **1.5px solid var(--ink)** (padding reduced to compensate `:569`).
- `.work-highlight`: **border-left 3px solid var(--blue-400)** (`:796-798`).
- `.project-detail-pullquote-stripe`: **2px** vertical blue-400 bar (`:1915-1922`).

### Box-shadows (only three real drop shadows)
- bento-card hover: `0 20px 40px rgba(17,24,34,0.08)` (`:899`)
- archive-dropdown-list: `0 12px 32px rgba(17,24,34,0.08)` (`:1552`)
- project-cursor pill: `0 8px 22px -10px color-mix(in srgb, var(--blue-500) 60%, transparent)` (`:1060`)
- Plus **shadow-as-accent-bar**: `archive-row--highlight` uses `inset 3px 0 0 var(--blue-400)` (`:1639-1642`) — same left-accent motif as work-highlight but via inset shadow.

### Bento pattern
4-col grid, `grid-auto-rows:1fr`, `aspect-ratio 2/1`, **gap 12px** (`:877-908`). Card = flex column, `justify-content:space-between` (eyebrow top, title+CTA bottom). Variants: default span 1; `--md` span 2 cols; `--lg` span 2×2 + **28px padding** (vs default 20px). Hover: `translateY(-4px)` + shadow. **Dual-image crossfade**: grayscale/luminosity "tonal" image at rest, full-color revealed on hover (`:986-1025`), disabled under `prefers-reduced-motion` + `pointer:coarse`. Responsive: 2-col ≤1100px, 1-col ≤720px (aspect 4/3).

---

## 4. Labels / chips / tags / eyebrows

### The eyebrow motif (recurring "small tracked label")
| Element | size | wt | tracking | case | color |
|---|---|---|---|---|---|
| section-index | 11px | 600 | 0.15em | **lowercase** | blue-500 (blue-200 on dark) `:603-610,1088` |
| stats-eyebrow | 11px | 600 | 0.15em | lowercase | blue-500 `:1414-1421` |
| bento-desc-top | 11px | 600 | 0.08em | lowercase | ink (blue-200 dark) `:909-916` |
| nav-avail | 10px | 600 | 0.1em | **UPPERCASE** | ink `:212-216` |
| work-highlight-label | 10px | 600 | 0.15em | **UPPERCASE** | blue-500 `:804-811` |
| project-detail-eyebrow / stack-label / what-shipped-label | 11px | 600 | **0.18em** | **UPPERCASE** | blue-400 `:1768-1776,2048-2055,2133-2139` |
| project-cursor__pill | 11px | — | 0.08em | UPPERCASE, **mono** | cream on blue-400 `:1054` |

**System rule (synthesized):** *lowercase* tracked labels = the marketing/section eyebrows (blue-500, 0.15em); *UPPERCASE* tracked labels = the project-detail / technical sub-labels (blue-400, 0.18em). This lowercase-vs-uppercase split is the clearest label convention in the system.

### Numbered-section motif ("01/02")
Copy format `NN · label`: `01 · featured`, `02 · everything`, `03 · experience`, `04 · expertise`, `05` (contact omits label) (`en.json:46,54,78,89,101`). Built by `SectionHeading.tsx:15-17` joining index + label with ` · `.
- **Contradiction between two numbering conventions:** Skills columns use inline `0{ci+1}` → `01/02/03` **without** the ` · label` (`Skills.tsx:37`), distinct from section-index. Row indices reuse tabular-nums small numerals: work-num (11px dust, `:701-706`), stats-row-num (13px/600 dust, `:1445`), archive-num (11px dust, `:1652`), contact-num (10px cream@0.4, `:1125`).

### Pills / chips / badges (all radius 999px)
- **Pill (static tag):** 11px/500 bark on **sand**, 1px mist, pad 6px 12px, lowercase; hover → blue-100 bg / blue-200 border / ink text (`:641-656`).
- **Chip (interactive filter):** 11px/500 bark on **cream**, 1px mist, pad 7px 14px, 0.02em; `.is-active` → **ink bg / cream text / ink border** (`:658-676`, `Tag.tsx:8-26`).
- **work-mode-pill:** blue-50 bg, no border, 11px/600 bark, 0.06em, + 6px periwinkle-300 dot (`:747-762`).
- **nav-avail:** cream bg, 1px mist, 10px/600 UPPERCASE, + pulsing periwinkle-300 dot with glow keyframes `rgba(80,120,184,0.2→0.05)` (`:206-237`).

---

## 5. Spacing

- **Section:** `140px 80px`, max-width 1440px (`:583-588`). `.section--sand` inner max-width 1280px. `.stats` `128px 80px`. `.section--contact` `160px 80px 120px` (`:1081`). `.footer` `60px 80px 40px`.
- **Responsive L/R padding:** 80px → 40px @≤1100px → 20px @≤720px; section becomes `100px 20px` @≤720px (`:1259-1340`).
- **section-header:** margin-bottom **64px**, max-width 720px; `.section-spacing-content` margin-top **96px** between heading and body (`:599-636`).
- **Gaps:** bento 12px · hero-stats 64px · skills-grid 56px · stats-inner 80px · hero-grid 40px · nav-links 26px · work-row-head 24px · contact-row 20px · work-bullets 10px (`:882,524,827,1407,265,152,694,1116,779`).
- **Internal padding:** bento-card 20px (lg 28px) · work-row-head 28px 32px · work-highlight 14px 20px · archive-row 14px 18px · nav 18px 40px (`:887,696,799,1631,128`).

---

## 6. Signature motifs

- **Dividers:** 1px solid mist hairlines as separators (hero-stats border-top, work-row border-bottom, `.project-detail-divider` max-width 620px / 48px margin `:1940-1945`). Decorative rule: `.project-detail-pitch::before` = 28px×2px blue-400 bar above pitch (`:2104-2111`).
- **Underlines:** nav-link `::after` = 1px blue-400 line animating right:100%→0 (left-to-right reveal `:195-204`); hero-role border-bottom 2px blue-200 → blue-400 on hover (`:485-507`).
- **Arrows:** btn-arrow → / ↓ nudges translateX/Y 3px on hover (`:576-578`); bento-cs literal `↗` prefix (`Projects.tsx:219`); contact-label-arrow + archive-arrow fade in on row hover; scroll-cue-arrow 18px blue-400; back-link literal `←` (`ProjectDetail.tsx:78`).
- **Markers/dots:** work-bullets `li::before` = 8px×1px blue-300 dash at top:0.65em (`:789-795`); skills-dot 5px circle scaling 1.6× blue-300→blue-500 on hover (`:860-871`); nav-mark/loader-mark small blue-400 dot forming the "ks." brand mark (`:173-180,357-368`).
- **Gradients:** ONLY one linear-gradient in the file — contact-row hover wash `linear-gradient(90deg, rgba(58,150,232,0.06), transparent)` + 20px left pad shift (`:1121-1124`). (Bento tonal→color is opacity crossfade, not a gradient.)
- **Kinetic type:** footer marquee = SVG **stroke-traced** "kevin shibuya" (stroke `rgba(246,249,252,0.25)`, stroke-width 6, fill transparent), 45s linear infinite scroll (`:1203-1233`); hero-name-drawing + footer glyphs use `stroke-dasharray/offset` ink-trace on custom paths in `src/data/glyphPaths.ts` (`:420-456`).

---

## 7. Copy tone (en.json)

- **Everything lowercase** except UPPERCASE-tracked eyebrows/pills. Terse sentence fragments, not full sentences.
- **Heading pattern:** `noun/verb + <em>emphasized closing word + period</em>`, em rendered blue italic: `selected <em>work.</em>`, `the <em>archive.</em>`, `work <em>history.</em>`, `skills & <em>tools.</em>`, `let's <em>build.</em>`, `the work, in <em>numbers.</em>` (`en.json:48,56,80,91,103`).
- **Subheads:** short lowercase declarative fragments — `personal highlights. from brief to ship.` · `everything i've shipped, searchable.` · `seven years shipping. seen by millions.` · `my stack: fast, without cutting craft.` · `got a project or rough idea? let's talk.` (`en.json:49,57,81,92,104`).
- **Hero:** name split `kevin` / `shibuya.`; rolePrefix `i am`; roles `[a senior front-end engineer, a system architect, a tech lead, an ai engineer]`; description uses inline arrow + `<strong>`: `<strong>rough ideas → shipped products.</strong> a team of one.` (`en.json:12-21`). The `→` glyph is literal in copy, echoing the arrow motif.
- Separator `·` recurs (nav index labels, footer copyright).

---

## 8. Contradictions & gaps flagged for the designer

1. **JetBrains Mono is dead CSS** — loaded as a token name only, never rendered. All 4 scouts confirm. "Mono" = system `ui-monospace`. (`:76` decl; deadEnds ×3)
2. **Two numbering conventions** — section eyebrows use `NN · label` (`en.json:46`); Skills uses bare `0N` (`Skills.tsx:37`). Pick intentionally.
3. **Hero-stat 40px vs Stats-row 56px** — different elements, not a conflict once disambiguated (`.hero-stat-v` `:531` vs `.stats-row-value` `:1456`).
4. **Dark bento-card & bento-card default background are set inline per-project**, not in `index.css` — the CSS only inverts *text* (`:877-930`). If replicating a bento card, choose the fill yourself (dark cards imply ink/near-ink).
5. **Contact/footer secondary colors are translucent cream, not palette tokens** — reproduce via `rgba(246,249,252, α)` at 0.6/0.5/0.4/0.12/0.08, not by picking bark/dust (`:1104-1181`).
6. **Periwinkle vs blue** — periwinkle-300 is a deliberate status accent (dots, company names); don't collapse it into the blue ramp.

**Gaps the scouts did not resolve:** exact per-project bento fill colors (set inline in components, not in CSS); `periwinkle-100/200` have declared hex but no cited usage; `src/data/glyphPaths.ts` path data was referenced but not extracted (only relevant if you reproduce the stroke-trace lettering).