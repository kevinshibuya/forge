# Two design references, split by authority, never averaged

The visual overhaul had two references, and each was given a distinct job: the "Bench — studio hours" artifact is the **app-wide visual language** (bone/ink ground, salmon and mint as the only two accents, grotesk type, 1px hairline separators rather than gray borders, pill controls, light/dark via `data-theme`), while the Dribbble "Vulnerability overview" shot is the **structural spine of the Overview page alone** (dark hero band with time-range pills and stat cards, over a light three-column lower band). The two are never averaged — the obvious move, and the one that would have produced a design tracing to neither.

Source: `docs/superpowers/specs/2026-08-10-overhaul-roadmap.md` (§Decisions locked — "Phase 3 design authority", and both transcribed reference anatomies); `docs/superpowers/specs/2026-08-16-design-system-shell-overview-design.md`.

## Consequences

- Both anatomies are transcribed in the roadmap — palette hexes, type scale, grammar, and the Dribbble band-by-band layout — so later work reads them there rather than re-fetching the sources.
- The Dribbble shot's purple/teal/orange accents are replaced by Bench salmon and mint, and its dark band uses Bench dark-bone rather than pure black. Grafts are adapted to the language, not imported with their own palette.
- Palette sweeps silently destroy figure/ground: every gate can pass while a page is unreadable. Reading the rendered page is the only check that catches it, and it found every genuinely valuable defect of the reskin phase.
